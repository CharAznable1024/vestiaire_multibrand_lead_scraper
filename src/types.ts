export type Market = 'US' | 'GB' | 'FR' | 'DE' | 'IT' | 'ES';
export type DedupeMode = 'all' | 'new_only' | 'new_and_updated';
export type DedupeStatus = 'new' | 'updated' | 'seen';
export type ContactStatus = 'not_requested' | 'not_eligible' | 'not_found' | 'candidate' | 'verified' | 'error';
export type SellerSegment = 'B2C' | 'C2C' | 'UNKNOWN';

export interface ProxyInput {
    useApifyProxy?: boolean;
    apifyProxyGroups?: string[];
    apifyProxyCountry?: string;
    proxyUrls?: string[];
}

export interface ActorInput {
    searchQueries?: unknown;
    startUrls?: unknown;
    country?: unknown;
    sellerCountries?: unknown;
    maxListingsPerQuery?: unknown;
    maxPagesPerQuery?: unknown;
    maxSellers?: unknown;
    maxSellerDetailCandidates?: unknown;
    minItemsSold?: unknown;
    minItemsListed?: unknown;
    allowedSellerSegments?: unknown;
    requireSellerDetails?: unknown;
    refreshProfileStats?: unknown;
    maxConcurrency?: unknown;
    maxSellerDetailConcurrency?: unknown;
    maxRequestRetries?: unknown;
    navigationTimeoutSecs?: unknown;
    proxyConfiguration?: unknown;
    autoMarketProxy?: unknown;
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
    searchQueries: string[];
    startUrls: string[];
    country: Market;
    sellerCountries: string[];
    maxListingsPerQuery: number;
    maxPagesPerQuery: number;
    maxSellers: number;
    maxSellerDetailCandidates: number;
    minItemsSold: number;
    minItemsListed: number;
    allowedSellerSegments: SellerSegment[];
    requireSellerDetails: boolean;
    refreshProfileStats: boolean;
    maxConcurrency: number;
    maxSellerDetailConcurrency: number;
    maxRequestRetries: number;
    navigationTimeoutSecs: number;
    proxyConfiguration: ProxyInput;
    autoMarketProxy: boolean;
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
    paginationStats?: { totalPages?: number };
}

export interface CapturedSearchResponse {
    endpoint: string;
    headers: Record<string, string>;
    payload: Record<string, unknown>;
    data: RawSearchResponse;
}

export interface ProductRecord {
    source_query: string;
    item_id: string;
    title: string;
    brand: string | null;
    category: string | null;
    category_path: string[];
    country: string | null;
    item_url: string;
    price_amount: number | null;
    price_currency: string | null;
    likes: number;
    seller_id: string | null;
    seller_display_name: string | null;
    seller_badge: string | null;
    is_official_store: boolean;
}

export interface SellerDetail {
    seller_id: string;
    seller_name: string | null;
    seller_username: string | null;
    seller_segment: SellerSegment;
    seller_country: string | null;
    seller_country_code: string | null;
    seller_badge: string | null;
    badges: string[];
    items_sold: number | null;
    items_listed: number | null;
    items_bought: number | null;
    items_wished: number | null;
    pass_rate: number | null;
    vacation_active: boolean | null;
    detail_category: string | null;
    detail_source_url: string;
    seller_stats_source: 'product_detail' | 'profile_page';
    seller_stats_observed_at: string;
}

export interface SellerAggregate {
    seller_id: string;
    display_name: string | null;
    search_badge: string | null;
    is_official_store: boolean;
    countries: string[];
    brands: string[];
    categories: string[];
    source_queries: string[];
    products: ProductRecord[];
}

export type Qualification = 'high' | 'medium' | 'low';

export interface LeadRecord {
    record_type: 'merchant_lead';
    schema_version: '2.0';
    seller_id: string;
    seller_name: string | null;
    seller_username: string | null;
    profile_url: string;
    seller_segment: SellerSegment;
    seller_country: string | null;
    seller_country_code: string | null;
    items_sold: number | null;
    items_listed: number | null;
    items_bought: number | null;
    items_wished: number | null;
    pass_rate: number | null;
    seller_badge: string | null;
    badges: string[];
    is_official_store: boolean;
    vacation_active: boolean | null;
    categories: string[];
    brands: string[];
    source_queries: string[];
    sample_listing_count: number;
    total_likes: number;
    average_price: number | null;
    price_currency: string | null;
    sample_product_urls: string[];
    seller_detail_source_url: string | null;
    seller_detail_status: 'enriched' | 'unavailable';
    seller_stats_source: 'product_detail' | 'profile_page' | 'unavailable';
    seller_stats_observed_at: string;
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
    schema_version: '2.0';
    sellers: Record<string, SellerState>;
}

export interface RunSummary {
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED';
    schema_version: '2.0';
    search_queries: string[];
    start_urls: string[];
    failed_sources: Array<{ source: string; error: string }>;
    listing_count: number;
    seller_count: number;
    seller_detail_attempted: number;
    seller_detail_succeeded: number;
    seller_detail_failed: number;
    qualified_lead_count: number;
    emitted_lead_count: number;
    duplicate_suppressed_count: number;
    bright_data_configured: boolean;
    bright_data_request_attempts: number;
    bright_data_successful_requests: number;
    bright_data_recovered_pages: number;
    bright_data_estimated_cost_usd: number;
    search_api_direct_sources: number;
    search_api_unblocker_sources: number;
    search_api_browser_sources: number;
    search_api_template_fallbacks: number;
    contact_enrichment_attempted: number;
    contact_enrichment_verified: number;
    contact_enrichment_cached: number;
    partial_lead_count: number;
    checkpoint_seller_count: number;
    checkpoint_updated_at?: string;
    started_at: string;
    finished_at?: string;
}
