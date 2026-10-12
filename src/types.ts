export type Market = 'US' | 'GB' | 'FR' | 'DE' | 'IT' | 'ES';
export type DedupeMode = 'all' | 'new_only' | 'new_and_updated';
export type DedupeStatus = 'new' | 'updated' | 'seen';
export type ContactStatus = 'not_requested' | 'not_eligible' | 'cached' | 'not_found' | 'candidate' | 'verified' | 'error';

export interface ProxyInput {
    useApifyProxy?: boolean;
    apifyProxyGroups?: string[];
    apifyProxyCountry?: string;
    proxyUrls?: string[];
}

export interface ActorInput {
    brands?: unknown;
    country?: unknown;
    maxItemsPerBrand?: unknown;
    maxPagesPerBrand?: unknown;
    minBrandCount?: unknown;
    minListingsPerSeller?: unknown;
    includeProducts?: unknown;
    maxConcurrency?: unknown;
    maxRequestRetries?: unknown;
    navigationTimeoutSecs?: unknown;
    proxyConfiguration?: unknown;
    dedupeMode?: unknown;
    dedupeStoreName?: unknown;
    reemitAfterDays?: unknown;
    contactEnrichment?: unknown;
    maxContactEnrichmentLeads?: unknown;
    minLeadScoreForEnrichment?: unknown;
    minContactConfidence?: unknown;
    contactCacheDays?: unknown;
    contactSearchActorId?: unknown;
}

export interface NormalizedInput {
    brands: string[];
    country: Market;
    maxItemsPerBrand: number;
    maxPagesPerBrand: number;
    minBrandCount: number;
    minListingsPerSeller: number;
    includeProducts: boolean;
    maxConcurrency: number;
    maxRequestRetries: number;
    navigationTimeoutSecs: number;
    proxyConfiguration: ProxyInput;
    dedupeMode: DedupeMode;
    dedupeStoreName: string;
    reemitAfterDays: number;
    contactEnrichment: boolean;
    maxContactEnrichmentLeads: number;
    minLeadScoreForEnrichment: number;
    minContactConfidence: number;
    contactCacheDays: number;
    contactSearchActorId: string;
}

export interface RawSearchResponse {
    items?: unknown[];
    paginationStats?: {
        totalPages?: number;
    };
}

export interface CapturedSearchResponse {
    endpoint: string;
    headers: Record<string, string>;
    payload: Record<string, unknown>;
    data: RawSearchResponse;
}

export interface ProductRecord {
    record_type: 'product';
    schema_version: '1.0';
    source_site: 'vestiaire_collective';
    search_brand: string;
    item_id: string;
    title: string;
    brand: string | null;
    description: string | null;
    country: string | null;
    item_url: string;
    price_amount: number | null;
    price_currency: string | null;
    original_price_amount: number | null;
    likes: number;
    sold: boolean;
    stock: boolean | number | string | null;
    colors: string[];
    image_urls: string[];
    seller_id: string | null;
    seller_display_name: string | null;
    seller_badge: string | null;
    is_official_store: boolean;
    seller_profile_url: string | null;
    scraped_at: string;
}

export type Qualification = 'high' | 'medium' | 'low';

export interface LeadRecord {
    record_type: 'merchant_lead';
    schema_version: '1.0';
    seller_id: string;
    display_name: string | null;
    seller_badge: string | null;
    is_official_store: boolean;
    countries: string[];
    brands: string[];
    brand_count: number;
    listing_count: number;
    total_likes: number;
    average_price: number | null;
    price_currency: string | null;
    sample_product_urls: string[];
    profile_url: string;
    lead_score: number;
    qualification: Qualification;
    qualification_reasons: string[];
    dedupe_status: DedupeStatus;
    first_seen_at: string;
    last_seen_at: string;
    times_seen: number;
    official_website: string | null;
    contact_candidate_url: string | null;
    public_business_emails: string[];
    public_business_phones: string[];
    social_urls: string[];
    contact_source_urls: string[];
    contact_confidence: number;
    contact_status: ContactStatus;
    contact_error: string | null;
    scraped_at: string;
}

export interface ContactDetails {
    official_website: string | null;
    contact_candidate_url: string | null;
    public_business_emails: string[];
    public_business_phones: string[];
    social_urls: string[];
    contact_source_urls: string[];
    contact_confidence: number;
    contact_status: ContactStatus;
    contact_error: string | null;
}

export interface SellerState {
    fingerprint: string;
    first_seen_at: string;
    last_seen_at: string;
    times_seen: number;
    last_emitted_at?: string;
    contact?: ContactDetails;
    contact_enriched_at?: string;
}

export interface PersistentLeadState {
    schema_version: '1.0';
    sellers: Record<string, SellerState>;
}

export interface RunSummary {
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED';
    schema_version: '1.0';
    searched_brands: string[];
    failed_brands: Array<{ brand: string; error: string }>;
    product_count: number;
    seller_count: number;
    qualified_lead_count: number;
    emitted_lead_count: number;
    duplicate_suppressed_count: number;
    contact_enrichment_attempted: number;
    contact_enrichment_verified: number;
    contact_enrichment_cached: number;
    started_at: string;
    finished_at?: string;
}
