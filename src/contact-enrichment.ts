import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { load } from 'cheerio';
import { Actor, log } from 'apify';

import type { ContactDetails, LeadRecord, NormalizedInput, PersistentLeadState } from './types.js';

interface OrganicResult {
    title?: string;
    url?: string;
    description?: string;
}

interface SearchResultPage {
    searchQuery?: { term?: string };
    organicResults?: OrganicResult[];
}

interface WebsiteInspection {
    candidateUrl: string;
    canonicalUrl: string;
    emails: string[];
    phones: string[];
    socialUrls: string[];
    sourceUrls: string[];
    confidence: number;
}

export interface ContactEnrichmentResult {
    leads: LeadRecord[];
    attempted: number;
    verified: number;
    cached: number;
}

const EXCLUDED_HOSTS = [
    'vestiairecollective.com',
    'google.com',
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'tiktok.com',
    'youtube.com',
    'x.com',
    'twitter.com',
    'wikipedia.org',
    'yelp.com',
    'trustpilot.com',
    'pinterest.com',
];
const SOCIAL_HOSTS = ['facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'youtube.com', 'x.com', 'twitter.com'];
const BUSINESS_KEYWORDS = /luxury|designer|resale|pre[- ]?owned|consignment|boutique|shop|store|fashion|handbag|jewelry|jewellery/i;
const CONTACT_LINK = /contact|about|customer.?service|help|support|reach.?us/i;
const GENERIC_EMAIL_LOCAL = /^(info|contact|hello|support|sales|wholesale|press|partnerships?|customer|help|business|team|shop|service|care)$/i;

function defaultContact(status: ContactDetails['contact_status'] = 'not_requested'): ContactDetails {
    return {
        official_website: null,
        contact_candidate_url: null,
        public_business_emails: [],
        public_business_phones: [],
        social_urls: [],
        contact_source_urls: [],
        contact_confidence: 0,
        contact_status: status,
        contact_error: null,
    };
}

function applyContact(lead: LeadRecord, contact: ContactDetails): LeadRecord {
    return { ...lead, ...contact };
}

function cacheFresh(enrichedAt: string | undefined, cacheDays: number, now: string): boolean {
    if (!enrichedAt || cacheDays <= 0) return false;
    const age = Date.parse(now) - Date.parse(enrichedAt);
    return Number.isFinite(age) && age >= 0 && age < cacheDays * 86_400_000;
}

function businessLike(lead: LeadRecord): boolean {
    if (lead.is_official_store) return true;
    const words = lead.display_name?.trim().split(/\s+/).filter(Boolean) ?? [];
    return words.length >= 2 || /store|shop|boutique|resale|luxury|collective|archive|vintage|\.com/i.test(lead.display_name ?? '');
}

function normalizeText(value: string): string {
    return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function compact(value: string): string {
    return normalizeText(value).replace(/\b(the|and|of|official|store|shop|inc|llc|ltd|co|company)\b/g, '').replace(/\s+/g, '');
}

function hostnameMatches(hostname: string, excluded: string): boolean {
    return hostname === excluded || hostname.endsWith(`.${excluded}`);
}

function candidateUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
        if (EXCLUDED_HOSTS.some((excluded) => hostnameMatches(hostname, excluded))) return null;
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
}

function privateIpv4(address: string): boolean {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return true;
    const [a, b] = octets;
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224
    );
}

function privateIp(address: string): boolean {
    if (isIP(address) === 4) return privateIpv4(address);
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}

async function assertPublicUrl(url: URL): Promise<void> {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsafe website URL');
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => privateIp(address))) throw new Error('Website resolved to a non-public address');
}

async function readLimited(response: Response, maxBytes = 1_500_000): Promise<string> {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let result = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            break;
        }
        result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
}

async function fetchHtml(input: string, redirects = 0): Promise<{ url: string; html: string }> {
    if (redirects > 4) throw new Error('Too many website redirects');
    const url = new URL(input);
    await assertPublicUrl(url);
    const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000),
        headers: {
            'user-agent': 'Mozilla/5.0 (compatible; VestiaireLeadResearch/1.0; public business contact verification)',
            accept: 'text/html,application/xhtml+xml',
        },
    });
    if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`Website redirect ${response.status} did not provide a location`);
        return fetchHtml(new URL(location, url).toString(), redirects + 1);
    }
    if (!response.ok) throw new Error(`Website returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        throw new Error(`Unsupported website content type: ${contentType || 'unknown'}`);
    }
    return { url: response.url || url.toString(), html: await readLimited(response) };
}

function domainRoot(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, '');
}

function parsePage(html: string, pageUrl: string): {
    title: string;
    text: string;
    emails: string[];
    phones: string[];
    socialUrls: string[];
    contactUrls: string[];
} {
    const $ = load(html);
    $('script,style,noscript,svg').remove();
    const title = $('title').first().text().trim();
    const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 250_000);
    const rootHost = domainRoot(new URL(pageUrl).hostname);
    const emails = new Set<string>();
    const phones = new Set<string>();
    const socialUrls = new Set<string>();
    const contactUrls = new Set<string>();

    $('a[href]').each((_index, element) => {
        const href = $(element).attr('href')?.trim();
        if (!href) return;
        if (href.toLowerCase().startsWith('mailto:')) {
            const email = href.slice(7).split('?')[0].trim().toLowerCase();
            const [local, host] = email.split('@');
            if (local && host && (domainRoot(host) === rootHost || GENERIC_EMAIL_LOCAL.test(local))) emails.add(email);
            return;
        }
        if (href.toLowerCase().startsWith('tel:')) {
            const phone = href.slice(4).split('?')[0].trim();
            if (phone.replace(/\D/g, '').length >= 7) phones.add(phone);
            return;
        }
        try {
            const absolute = new URL(href, pageUrl);
            const hostname = domainRoot(absolute.hostname);
            if (SOCIAL_HOSTS.some((social) => hostnameMatches(hostname, social))) socialUrls.add(absolute.toString());
            if (hostname === rootHost && CONTACT_LINK.test(`${absolute.pathname} ${$(element).text()}`)) {
                absolute.hash = '';
                contactUrls.add(absolute.toString());
            }
        } catch {
            // Ignore malformed links from untrusted pages.
        }
    });

    return {
        title,
        text,
        emails: [...emails],
        phones: [...phones],
        socialUrls: [...socialUrls],
        contactUrls: [...contactUrls].slice(0, 2),
    };
}

function confidenceScore(
    displayName: string,
    result: OrganicResult,
    websiteUrl: string,
    pages: ReturnType<typeof parsePage>[],
): number {
    const name = compact(displayName);
    const host = compact(new URL(websiteUrl).hostname.split('.')[0]);
    const combinedTitle = normalizeText(pages.map((page) => page.title).join(' '));
    const combinedText = normalizeText(pages.map((page) => page.text).join(' '));
    const searchText = normalizeText(`${result.title ?? ''} ${result.description ?? ''}`);
    const emails = pages.flatMap((page) => page.emails);
    const phones = pages.flatMap((page) => page.phones);

    let score = 0;
    if (name.length >= 4 && (host.includes(name) || name.includes(host))) score += 30;
    if (name.length >= 4 && compact(combinedTitle).includes(name)) score += 20;
    if (name.length >= 4 && compact(combinedText).includes(name)) score += 15;
    if (name.length >= 4 && compact(searchText).includes(name)) score += 10;
    if (BUSINESS_KEYWORDS.test(combinedText)) score += 10;
    if (emails.some((email) => domainRoot(email.split('@')[1] ?? '') === domainRoot(new URL(websiteUrl).hostname))) score += 10;
    if (phones.length > 0 || pages.length > 1) score += 5;
    return Math.min(100, score);
}

async function inspectWebsite(displayName: string, result: OrganicResult): Promise<WebsiteInspection> {
    const initial = candidateUrl(result.url);
    if (!initial) throw new Error('Search result is not a permitted website candidate');
    const home = await fetchHtml(initial);
    const homePage = parsePage(home.html, home.url);
    const pages = [homePage];
    const sourceUrls = [home.url];

    for (const contactUrl of homePage.contactUrls) {
        try {
            const contact = await fetchHtml(contactUrl);
            pages.push(parsePage(contact.html, contact.url));
            sourceUrls.push(contact.url);
        } catch (error) {
            log.debug('Could not fetch a candidate contact page', { url: contactUrl, error: String(error) });
        }
    }

    return {
        candidateUrl: initial,
        canonicalUrl: new URL('/', home.url).toString(),
        emails: [...new Set(pages.flatMap((page) => page.emails))],
        phones: [...new Set(pages.flatMap((page) => page.phones))],
        socialUrls: [...new Set(pages.flatMap((page) => page.socialUrls))],
        sourceUrls: [...new Set(sourceUrls)],
        confidence: confidenceScore(displayName, result, home.url, pages),
    };
}

function contactFromInspection(inspection: WebsiteInspection, minimumConfidence: number): ContactDetails {
    if (inspection.confidence >= minimumConfidence) {
        return {
            official_website: inspection.canonicalUrl,
            contact_candidate_url: inspection.candidateUrl,
            public_business_emails: inspection.emails,
            public_business_phones: inspection.phones,
            social_urls: inspection.socialUrls,
            contact_source_urls: inspection.sourceUrls,
            contact_confidence: inspection.confidence,
            contact_status: 'verified',
            contact_error: null,
        };
    }
    return {
        ...defaultContact(inspection.confidence >= 60 ? 'candidate' : 'not_found'),
        contact_candidate_url: inspection.candidateUrl,
        contact_source_urls: inspection.sourceUrls,
        contact_confidence: inspection.confidence,
    };
}

async function searchOfficialWebsites(
    leads: LeadRecord[],
    input: NormalizedInput,
): Promise<Map<string, OrganicResult[]>> {
    const queries = leads.map((lead) => `"${lead.display_name}" official website luxury resale`).join('\n');
    const run = await Actor.call(
        input.contactSearchActorId,
        {
            queries,
            maxPagesPerQuery: 1,
            resultsPerPage: 5,
            countryCode: input.country.toLowerCase(),
            languageCode: 'en',
            mobileResults: false,
            includeUnfilteredResults: false,
            saveHtml: false,
            saveHtmlToKeyValueStore: false,
            includeIcons: false,
            maximumLeadsEnrichmentRecords: 0,
        },
        { timeout: 300 },
    );
    if (!run.defaultDatasetId) throw new Error('Search Actor did not return a default dataset');
    const { items } = await Actor.apifyClient.dataset(run.defaultDatasetId).listItems({ clean: true, limit: leads.length + 5 });
    const result = new Map<string, OrganicResult[]>();
    items.forEach((item, index) => {
        const page = item as SearchResultPage;
        const term = page.searchQuery?.term;
        const lead = (term && leads.find((candidate) => term.includes(candidate.display_name ?? ''))) ?? leads[index];
        if (lead) result.set(lead.seller_id, page.organicResults ?? []);
    });
    return result;
}

export async function enrichContacts(
    sourceLeads: LeadRecord[],
    input: NormalizedInput,
    state: PersistentLeadState,
    now: string,
): Promise<ContactEnrichmentResult> {
    const leads = sourceLeads.map((lead) => ({ ...lead }));
    let cached = 0;

    if (!input.contactEnrichment || input.maxContactEnrichmentLeads === 0) {
        return { leads, attempted: 0, verified: 0, cached };
    }

    for (let index = 0; index < leads.length; index += 1) {
        const lead = leads[index];
        const previous = state.sellers[lead.seller_id];
        if (previous?.contact && cacheFresh(previous.contact_enriched_at, input.contactCacheDays, now)) {
            leads[index] = applyContact(lead, previous.contact);
            cached += 1;
        }
    }

    const selected = leads
        .filter(
            (lead) =>
                lead.contact_status === 'not_requested' &&
                lead.lead_score >= input.minLeadScoreForEnrichment &&
                Boolean(lead.display_name) &&
                businessLike(lead),
        )
        .sort((left, right) => right.lead_score - left.lead_score)
        .slice(0, input.maxContactEnrichmentLeads);
    const selectedIds = new Set(selected.map((lead) => lead.seller_id));

    for (let index = 0; index < leads.length; index += 1) {
        const lead = leads[index];
        if (lead.contact_status !== 'not_requested' || selectedIds.has(lead.seller_id)) continue;
        const previous = state.sellers[lead.seller_id];
        leads[index] = previous?.contact ? applyContact(lead, previous.contact) : applyContact(lead, defaultContact('not_eligible'));
    }
    if (!selected.length) return { leads, attempted: 0, verified: 0, cached };

    let searchResults: Map<string, OrganicResult[]>;
    try {
        searchResults = await searchOfficialWebsites(selected, input);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Public website discovery failed', { error: message });
        return {
            leads: leads.map((lead) =>
                selectedIds.has(lead.seller_id)
                    ? state.sellers[lead.seller_id]?.contact
                        ? applyContact(lead, {
                              ...(state.sellers[lead.seller_id].contact as ContactDetails),
                              contact_error: message.slice(0, 500),
                          })
                        : applyContact(lead, { ...defaultContact('error'), contact_error: message.slice(0, 500) })
                    : lead,
            ),
            attempted: selected.length,
            verified: 0,
            cached,
        };
    }

    let verified = 0;
    for (let index = 0; index < leads.length; index += 1) {
        const lead = leads[index];
        if (!selectedIds.has(lead.seller_id)) continue;
        const organicResults = searchResults.get(lead.seller_id) ?? [];
        let best: ContactDetails = defaultContact('not_found');

        for (const organicResult of organicResults.slice(0, 5)) {
            try {
                const inspection = await inspectWebsite(lead.display_name as string, organicResult);
                const contact = contactFromInspection(inspection, input.minContactConfidence);
                if (contact.contact_confidence > best.contact_confidence) best = contact;
                if (contact.contact_status === 'verified') break;
            } catch (error) {
                log.debug('Website candidate rejected', { sellerId: lead.seller_id, url: organicResult.url, error: String(error) });
            }
        }
        if (best.contact_status === 'verified') verified += 1;
        leads[index] = applyContact(lead, best);
    }

    return { leads, attempted: selected.length, verified, cached };
}

export const testing = { businessLike, candidateUrl, confidenceScore, parsePage };
