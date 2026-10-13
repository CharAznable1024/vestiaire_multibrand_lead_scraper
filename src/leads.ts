import { sellerProfileUrl } from './market.js';
import type {
    LeadRecord,
    Market,
    NormalizedInput,
    ProductRecord,
    Qualification,
    SellerAggregate,
    SellerDetail,
} from './types.js';

interface ScoreResult {
    score: number;
    qualification: Qualification;
    reasons: string[];
}

function sellerScore(aggregate: SellerAggregate, detail: SellerDetail | undefined): ScoreResult {
    const reasons: string[] = [];
    const sold = detail?.items_sold ?? 0;
    const listed = detail?.items_listed ?? 0;
    const likes = aggregate.products.reduce((sum, product) => sum + product.likes, 0);

    const soldPoints = sold > 0 ? Math.min(35, Math.round(Math.log10(sold + 1) * 16)) : 0;
    const listedPoints = listed > 0 ? Math.min(20, Math.round(Math.log10(listed + 1) * 9)) : 0;
    const samplePoints = Math.min(10, aggregate.products.length * 2);
    const categoryPoints = Math.min(5, aggregate.categories.length * 2);
    const engagementPoints = Math.min(5, Math.round(Math.log10(likes + 1) * 3));
    let score = soldPoints + listedPoints + samplePoints + categoryPoints + engagementPoints;

    if (sold > 0) reasons.push(`${sold} public items sold`);
    if (listed > 0) reasons.push(`${listed} public items listed`);
    if (aggregate.products.length > 1) reasons.push(`${aggregate.products.length} listings in this sample`);
    if (aggregate.categories.length > 1) reasons.push(`${aggregate.categories.length} sampled categories`);

    if (detail?.seller_segment === 'B2C') {
        score += 15;
        reasons.push('public B2C seller segment');
    }
    if (aggregate.is_official_store) {
        score += 10;
        reasons.push('marked as an official store');
    }
    const badge = (detail?.seller_badge ?? aggregate.search_badge)?.toLowerCase();
    if (badge === 'expert') {
        score += 10;
        reasons.push('public Expert badge');
    } else if (badge === 'trusted') {
        score += 7;
        reasons.push('public Trusted badge');
    } else if (badge) {
        score += 3;
        reasons.push(`public ${detail?.seller_badge ?? aggregate.search_badge} badge`);
    }

    score = Math.min(100, score);
    return { score, qualification: score >= 65 ? 'high' : score >= 40 ? 'medium' : 'low', reasons };
}

export function aggregateSellers(products: ProductRecord[]): SellerAggregate[] {
    const sellers = new Map<string, {
        seller_id: string;
        display_name: string | null;
        search_badge: string | null;
        is_official_store: boolean;
        countries: Set<string>;
        brands: Set<string>;
        categories: Set<string>;
        source_queries: Set<string>;
        products: ProductRecord[];
    }>();

    for (const product of products) {
        if (!product.seller_id) continue;
        const seller = sellers.get(product.seller_id) ?? {
            seller_id: product.seller_id,
            display_name: product.seller_display_name,
            search_badge: product.seller_badge,
            is_official_store: product.is_official_store,
            countries: new Set<string>(),
            brands: new Set<string>(),
            categories: new Set<string>(),
            source_queries: new Set<string>(),
            products: [],
        };
        seller.display_name ??= product.seller_display_name;
        seller.search_badge ??= product.seller_badge;
        seller.is_official_store ||= product.is_official_store;
        if (product.country) seller.countries.add(product.country);
        if (product.brand) seller.brands.add(product.brand);
        if (product.category) seller.categories.add(product.category);
        seller.source_queries.add(product.source_query);
        seller.products.push(product);
        sellers.set(product.seller_id, seller);
    }

    return [...sellers.values()]
        .map((seller) => ({
            ...seller,
            countries: [...seller.countries].sort(),
            brands: [...seller.brands].sort(),
            categories: [...seller.categories].sort(),
            source_queries: [...seller.source_queries].sort(),
        }))
        .sort((left, right) => right.products.length - left.products.length);
}

export function buildMerchantLeads(
    aggregates: SellerAggregate[],
    details: Map<string, SellerDetail>,
    input: NormalizedInput,
    market: Market,
    scrapedAt: string,
): LeadRecord[] {
    return aggregates
        .filter((aggregate) => {
            const detail = details.get(aggregate.seller_id);
            if (input.requireSellerDetails && !detail) return false;
            if (input.requireSellerDetails && detail?.items_sold === null) return false;
            if ((detail?.items_sold ?? -1) < input.minItemsSold) return false;
            if ((detail?.items_listed ?? -1) < input.minItemsListed) return false;
            const segment = detail?.seller_segment ?? 'UNKNOWN';
            return input.allowedSellerSegments.includes(segment);
        })
        .map((aggregate) => {
            const detail = details.get(aggregate.seller_id);
            const priced = aggregate.products.filter((product) => product.price_amount !== null && product.price_currency !== null);
            const currencies = new Set(priced.map((product) => product.price_currency as string));
            const comparable = currencies.size === 1 ? priced : [];
            const averagePrice = comparable.length
                ? Number((comparable.reduce((sum, product) => sum + (product.price_amount as number), 0) / comparable.length).toFixed(2))
                : null;
            const categories = [...new Set([...aggregate.categories, ...(detail?.detail_category ? [detail.detail_category] : [])])].sort();
            const { score, qualification, reasons } = sellerScore({ ...aggregate, categories }, detail);
            const sellerName = detail?.seller_name ?? aggregate.display_name;

            return {
                record_type: 'merchant_lead' as const,
                schema_version: '2.0' as const,
                seller_id: aggregate.seller_id,
                seller_name: sellerName,
                seller_username: detail?.seller_username ?? null,
                profile_url: sellerProfileUrl(aggregate.seller_id, market),
                seller_segment: detail?.seller_segment ?? 'UNKNOWN',
                seller_country: detail?.seller_country ?? aggregate.countries[0] ?? null,
                seller_country_code: detail?.seller_country_code ?? null,
                items_sold: detail?.items_sold ?? null,
                items_listed: detail?.items_listed ?? null,
                items_bought: detail?.items_bought ?? null,
                items_wished: detail?.items_wished ?? null,
                pass_rate: detail?.pass_rate ?? null,
                seller_badge: detail?.seller_badge ?? aggregate.search_badge,
                badges: detail?.badges ?? [],
                is_official_store: aggregate.is_official_store,
                vacation_active: detail?.vacation_active ?? null,
                categories,
                brands: aggregate.brands,
                source_queries: aggregate.source_queries,
                sample_listing_count: aggregate.products.length,
                total_likes: aggregate.products.reduce((sum, product) => sum + product.likes, 0),
                average_price: averagePrice,
                price_currency: currencies.size === 1 ? [...currencies][0] : null,
                sample_product_urls: [...new Set(aggregate.products.map((product) => product.item_url))].slice(0, 5),
                seller_detail_source_url: detail?.detail_source_url ?? null,
                seller_detail_status: detail ? ('enriched' as const) : ('unavailable' as const),
                lead_score: score,
                qualification,
                qualification_reasons: reasons,
                dedupe_status: 'new' as const,
                first_seen_at: scrapedAt,
                last_seen_at: scrapedAt,
                times_seen: 1,
                official_website: null,
                contact_candidate_url: null,
                public_business_emails: [],
                public_business_phones: [],
                social_urls: [],
                contact_source_urls: [],
                contact_confidence: 0,
                contact_status: 'not_requested' as const,
                contact_error: null,
                scraped_at: scrapedAt,
            };
        })
        .sort((left, right) => right.lead_score - left.lead_score || (right.items_sold ?? 0) - (left.items_sold ?? 0));
}

export function countSellers(products: ProductRecord[]): number {
    return new Set(products.map((product) => product.seller_id).filter(Boolean)).size;
}
