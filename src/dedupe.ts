import { createHash } from 'node:crypto';

import type {
    ContactDetails,
    DedupeMode,
    LeadRecord,
    PersistentLeadState,
    SellerState,
} from './types.js';

export interface DedupeResult {
    emitted: LeadRecord[];
    all: LeadRecord[];
    suppressed: number;
    state: PersistentLeadState;
}

export function emptyPersistentState(): PersistentLeadState {
    return { schema_version: '1.0', sellers: {} };
}

export function normalizePersistentState(value: unknown): PersistentLeadState {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyPersistentState();
    const candidate = value as Partial<PersistentLeadState>;
    if (candidate.schema_version !== '1.0' || !candidate.sellers || typeof candidate.sellers !== 'object') {
        return emptyPersistentState();
    }
    return candidate as PersistentLeadState;
}

export function contactFromLead(lead: LeadRecord): ContactDetails {
    return {
        official_website: lead.official_website,
        contact_candidate_url: lead.contact_candidate_url,
        public_business_emails: [...lead.public_business_emails],
        public_business_phones: [...lead.public_business_phones],
        social_urls: [...lead.social_urls],
        contact_source_urls: [...lead.contact_source_urls],
        contact_confidence: lead.contact_confidence,
        contact_status: lead.contact_status,
        contact_error: lead.contact_error,
    };
}

export function leadFingerprint(lead: LeadRecord): string {
    const stable = {
        display_name: lead.display_name,
        seller_badge: lead.seller_badge,
        is_official_store: lead.is_official_store,
        countries: [...lead.countries].sort(),
        brands: [...lead.brands].sort(),
        official_website: lead.official_website,
        public_business_emails: [...lead.public_business_emails].sort(),
        public_business_phones: [...lead.public_business_phones].sort(),
        social_urls: [...lead.social_urls].sort(),
        contact_status: lead.contact_status,
    };
    return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function shouldReemit(previous: SellerState, now: string, reemitAfterDays: number): boolean {
    if (reemitAfterDays <= 0) return false;
    const elapsedMillis = Date.parse(now) - Date.parse(previous.last_emitted_at ?? previous.first_seen_at);
    return Number.isFinite(elapsedMillis) && elapsedMillis >= reemitAfterDays * 86_400_000;
}

export function applyCrossRunDedupe(
    leads: LeadRecord[],
    previousState: PersistentLeadState,
    mode: DedupeMode,
    reemitAfterDays: number,
    now: string,
): DedupeResult {
    const nextState: PersistentLeadState = {
        schema_version: '1.0',
        sellers: { ...previousState.sellers },
    };
    const emitted: LeadRecord[] = [];
    const all: LeadRecord[] = [];

    for (const lead of leads) {
        const previous = previousState.sellers[lead.seller_id];
        const fingerprint = leadFingerprint(lead);
        const changed = Boolean(previous && previous.fingerprint !== fingerprint);
        const dedupeStatus = previous ? (changed ? 'updated' : 'seen') : 'new';
        const periodicReemit = previous !== undefined && shouldReemit(previous, now, reemitAfterDays);
        const emit =
            mode === 'all' ||
            dedupeStatus === 'new' ||
            (mode === 'new_and_updated' && dedupeStatus === 'updated') ||
            (mode === 'new_and_updated' && periodicReemit);
        const enrichedAt = ['verified', 'candidate', 'not_found'].includes(lead.contact_status)
            ? now
            : previous?.contact_enriched_at;

        const decorated: LeadRecord = {
            ...lead,
            dedupe_status: dedupeStatus,
            first_seen_at: previous?.first_seen_at ?? now,
            last_seen_at: now,
            times_seen: (previous?.times_seen ?? 0) + 1,
        };
        all.push(decorated);

        nextState.sellers[lead.seller_id] = {
            fingerprint,
            first_seen_at: decorated.first_seen_at,
            last_seen_at: now,
            times_seen: decorated.times_seen,
            last_emitted_at: emit ? now : (previous?.last_emitted_at ?? previous?.first_seen_at ?? now),
            contact: contactFromLead(decorated),
            ...(enrichedAt ? { contact_enriched_at: enrichedAt } : {}),
        };

        if (emit) emitted.push(decorated);
    }

    return { emitted, all, suppressed: all.length - emitted.length, state: nextState };
}
