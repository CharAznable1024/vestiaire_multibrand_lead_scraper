import type { ActorInput, DedupeMode, Market, NormalizedInput, ProxyInput } from './types.js';

const MARKETS = new Set<Market>(['US', 'GB', 'FR', 'DE', 'IT', 'ES']);

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

function proxy(value: unknown): ProxyInput {
    if (value === undefined) return { useApifyProxy: false };
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('proxyConfiguration must be an object');
    }
    return value as ProxyInput;
}

function text(value: unknown, fallback: string, field: string, pattern?: RegExp): string {
    const candidate = value === undefined ? fallback : value;
    if (typeof candidate !== 'string' || !candidate.trim() || (pattern && !pattern.test(candidate))) {
        throw new Error(`${field} is invalid`);
    }
    return candidate.trim();
}

export function normalizeInput(raw: ActorInput | null | undefined): NormalizedInput {
    const input = raw ?? {};
    if (!Array.isArray(input.brands)) throw new Error('brands must be an array of strings');

    const brands = [...new Set(input.brands.map((brand) => (typeof brand === 'string' ? brand.trim() : '')))].filter(
        Boolean,
    );
    if (brands.length < 1 || brands.length > 20) throw new Error('brands must contain between 1 and 20 values');

    const country = (input.country ?? 'US') as Market;
    if (!MARKETS.has(country)) throw new Error(`Unsupported country: ${String(input.country)}`);

    const maxItemsPerBrand = integer(input.maxItemsPerBrand, 48, 1, 500, 'maxItemsPerBrand');
    const maxPagesPerBrand = integer(input.maxPagesPerBrand, 2, 1, 10, 'maxPagesPerBrand');
    const minBrandCount = integer(input.minBrandCount, 2, 1, 20, 'minBrandCount');
    const minListingsPerSeller = integer(input.minListingsPerSeller, 2, 1, 100, 'minListingsPerSeller');

    if (minBrandCount > brands.length) {
        throw new Error('minBrandCount cannot exceed the number of distinct brands');
    }

    const dedupeMode = (input.dedupeMode ?? 'new_and_updated') as DedupeMode;
    if (!['all', 'new_only', 'new_and_updated'].includes(dedupeMode)) {
        throw new Error('dedupeMode must be all, new_only, or new_and_updated');
    }

    return {
        brands,
        country,
        maxItemsPerBrand,
        maxPagesPerBrand,
        minBrandCount,
        minListingsPerSeller,
        includeProducts: boolean(input.includeProducts, false, 'includeProducts'),
        maxConcurrency: integer(input.maxConcurrency, 1, 1, 3, 'maxConcurrency'),
        maxRequestRetries: integer(input.maxRequestRetries, 2, 0, 5, 'maxRequestRetries'),
        navigationTimeoutSecs: integer(input.navigationTimeoutSecs, 60, 15, 180, 'navigationTimeoutSecs'),
        proxyConfiguration: proxy(input.proxyConfiguration),
        dedupeMode,
        dedupeStoreName: text(
            input.dedupeStoreName,
            'vestiaire-multibrand-lead-state',
            'dedupeStoreName',
            /^[a-zA-Z0-9._-]{3,63}$/,
        ),
        reemitAfterDays: integer(input.reemitAfterDays, 30, 0, 3650, 'reemitAfterDays'),
        contactEnrichment: boolean(input.contactEnrichment, true, 'contactEnrichment'),
        maxContactEnrichmentLeads: integer(
            input.maxContactEnrichmentLeads,
            10,
            0,
            50,
            'maxContactEnrichmentLeads',
        ),
        minLeadScoreForEnrichment: integer(
            input.minLeadScoreForEnrichment,
            50,
            0,
            100,
            'minLeadScoreForEnrichment',
        ),
        minContactConfidence: integer(input.minContactConfidence, 80, 0, 100, 'minContactConfidence'),
        contactCacheDays: integer(input.contactCacheDays, 30, 0, 3650, 'contactCacheDays'),
        contactSearchActorId: text(
            input.contactSearchActorId,
            'apify/google-search-scraper',
            'contactSearchActorId',
        ),
    };
}
