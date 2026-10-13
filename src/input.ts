import type { ActorInput, DedupeMode, Market, NormalizedInput, ProxyInput, SellerSegment } from './types.js';

const MARKETS = new Set<Market>(['US', 'GB', 'FR', 'DE', 'IT', 'ES']);
const SEGMENTS = new Set<SellerSegment>(['B2C', 'C2C', 'UNKNOWN']);

function integer(value: unknown, fallback: number, minimum: number, maximum: number, field: string): number {
    const candidate = value === undefined ? fallback : value;
    if (!Number.isInteger(candidate) || (candidate as number) < minimum || (candidate as number) > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return candidate as number;
}

function boolean(value: unknown, fallback: boolean, field: string): boolean {
    const candidate = value === undefined ? fallback : value;
    if (typeof candidate !== 'boolean') throw new Error(`${field} must be a boolean`);
    return candidate;
}

function text(value: unknown, fallback: string, field: string, pattern?: RegExp): string {
    const candidate = value === undefined ? fallback : value;
    if (typeof candidate !== 'string' || !candidate.trim() || (pattern && !pattern.test(candidate))) {
        throw new Error(`${field} is invalid`);
    }
    return candidate.trim();
}

function stringList(value: unknown, fallback: string[], field: string, maximum: number): string[] {
    const candidate = value === undefined ? fallback : value;
    if (!Array.isArray(candidate)) throw new Error(`${field} must be an array of strings`);
    const values = [...new Set(candidate.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean))];
    if (values.length > maximum) throw new Error(`${field} cannot contain more than ${maximum} values`);
    return values;
}

function startUrls(value: unknown): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('startUrls must be an array');
    const urls = value.map((item) => {
        const raw = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as { url?: unknown }).url : null;
        if (typeof raw !== 'string') throw new Error('Each startUrls item must contain a URL');
        const url = new URL(raw);
        if (url.protocol !== 'https:' || !url.hostname.toLowerCase().endsWith('vestiairecollective.com')) {
            throw new Error('startUrls must be public HTTPS Vestiaire Collective URLs');
        }
        return url.toString();
    });
    return [...new Set(urls)];
}

function proxy(value: unknown): ProxyInput {
    if (value === undefined) return { useApifyProxy: false };
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('proxyConfiguration must be an object');
    return value as ProxyInput;
}

export function normalizeInput(raw: ActorInput | null | undefined): NormalizedInput {
    const input = raw ?? {};
    const searchQueries = stringList(input.searchQueries, [], 'searchQueries', 20);
    const urls = startUrls(input.startUrls);

    const country = (input.country ?? 'US') as Market;
    if (!MARKETS.has(country)) throw new Error(`Unsupported country: ${String(input.country)}`);
    const sellerCountries = stringList(input.sellerCountries, [], 'sellerCountries', 50).map((value) => value.toUpperCase());
    if (sellerCountries.some((value) => !/^[A-Z]{2}$/.test(value))) {
        throw new Error('sellerCountries must contain ISO 3166-1 alpha-2 country codes');
    }

    const allowedSellerSegments = stringList(
        input.allowedSellerSegments,
        ['B2C', 'C2C', 'UNKNOWN'],
        'allowedSellerSegments',
        3,
    ).map((value) => value.toUpperCase() as SellerSegment);
    if (!allowedSellerSegments.length || allowedSellerSegments.some((segment) => !SEGMENTS.has(segment))) {
        throw new Error('allowedSellerSegments can contain only B2C, C2C, and UNKNOWN');
    }

    const dedupeMode = (input.dedupeMode ?? 'new_and_updated') as DedupeMode;
    if (!['all', 'new_only', 'new_and_updated'].includes(dedupeMode)) {
        throw new Error('dedupeMode must be all, new_only, or new_and_updated');
    }

    const maxSellers = integer(input.maxSellers, 25, 1, 200, 'maxSellers');
    const maxSellerDetailCandidates = integer(
        input.maxSellerDetailCandidates,
        Math.min(500, Math.max(50, maxSellers * 4)),
        1,
        500,
        'maxSellerDetailCandidates',
    );
    if (maxSellerDetailCandidates < maxSellers) {
        throw new Error('maxSellerDetailCandidates must be at least maxSellers');
    }

    return {
        searchQueries,
        startUrls: urls,
        country,
        sellerCountries,
        maxListingsPerQuery: integer(input.maxListingsPerQuery, 48, 1, 500, 'maxListingsPerQuery'),
        maxPagesPerQuery: integer(input.maxPagesPerQuery, 1, 1, 10, 'maxPagesPerQuery'),
        maxSellers,
        maxSellerDetailCandidates,
        minItemsSold: integer(input.minItemsSold, 5, 0, 1_000_000, 'minItemsSold'),
        minItemsListed: integer(input.minItemsListed, 1, 0, 1_000_000, 'minItemsListed'),
        allowedSellerSegments,
        requireSellerDetails: boolean(input.requireSellerDetails, true, 'requireSellerDetails'),
        refreshProfileStats: boolean(input.refreshProfileStats, true, 'refreshProfileStats'),
        maxConcurrency: integer(input.maxConcurrency, 1, 1, 3, 'maxConcurrency'),
        maxSellerDetailConcurrency: integer(
            input.maxSellerDetailConcurrency,
            3,
            1,
            5,
            'maxSellerDetailConcurrency',
        ),
        maxRequestRetries: integer(input.maxRequestRetries, 2, 0, 5, 'maxRequestRetries'),
        navigationTimeoutSecs: integer(input.navigationTimeoutSecs, 60, 15, 180, 'navigationTimeoutSecs'),
        proxyConfiguration: proxy(input.proxyConfiguration),
        autoMarketProxy: boolean(input.autoMarketProxy, true, 'autoMarketProxy'),
        dedupeMode,
        dedupeStoreName: text(
            input.dedupeStoreName,
            'vestiaire-merchant-lead-state-v2',
            'dedupeStoreName',
            /^[a-zA-Z0-9._-]{3,63}$/,
        ),
        reemitAfterDays: integer(input.reemitAfterDays, 30, 0, 3650, 'reemitAfterDays'),
        contactEnrichment: boolean(input.contactEnrichment, true, 'contactEnrichment'),
        maxContactEnrichmentLeads: integer(input.maxContactEnrichmentLeads, 10, 0, 50, 'maxContactEnrichmentLeads'),
        minLeadScoreForEnrichment: integer(input.minLeadScoreForEnrichment, 50, 0, 100, 'minLeadScoreForEnrichment'),
        minContactConfidence: integer(input.minContactConfidence, 80, 0, 100, 'minContactConfidence'),
        contactCacheDays: integer(input.contactCacheDays, 30, 0, 3650, 'contactCacheDays'),
        contactSearchActorId: text(input.contactSearchActorId, 'apify/google-search-scraper', 'contactSearchActorId'),
    };
}
