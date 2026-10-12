import { sellerProfileUrl } from './market.js';
import type { LeadRecord, Market, ProductRecord, Qualification } from './types.js';

interface SellerAccumulator {
    sellerId: string;
    displayName: string | null;
    badge: string | null;
    official: boolean;
    countries: Set<string>;
    brands: Set<string>;
    products: ProductRecord[];
}

function leadScore(accumulator: SellerAccumulator): { score: number; qualification: Qualification; reasons: string[] } {
    const reasons: string[] = [];
    const brandPoints = Math.min(35, accumulator.brands.size * 12);
    const listingPoints = Math.min(25, accumulator.products.length * 3);
    const likes = accumulator.products.reduce((sum, product) => sum + product.likes, 0);
    const engagementPoints = Math.min(10, Math.round(Math.log10(likes + 1) * 5));

    let score = brandPoints + listingPoints + engagementPoints;
    if (accumulator.brands.size > 1) reasons.push(`${accumulator.brands.size} searched brands represented`);
    if (accumulator.products.length > 1) reasons.push(`${accumulator.products.length} matching listings`);
    if (likes > 0) reasons.push(`${likes} total likes across sampled listings`);

    if (accumulator.official) {
        score += 20;
        reasons.push('marked as an official store');
    }

    const badge = accumulator.badge?.toLowerCase();
    if (badge === 'expert') {
        score += 15;
        reasons.push('public Expert badge');
    } else if (badge === 'trusted') {
        score += 10;
        reasons.push('public Trusted badge');
    } else if (accumulator.badge) {
        score += 5;
        reasons.push(`public ${accumulator.badge} badge`);
    }

    score = Math.min(100, score);
    const qualification: Qualification = score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';
    return { score, qualification, reasons };
}

export function buildLeads(
    products: ProductRecord[],
    market: Market,
    minBrandCount: number,
    minListingsPerSeller: number,
    scrapedAt: string,
): LeadRecord[] {
    const sellers = new Map<string, SellerAccumulator>();

    for (const product of products) {
        if (!product.seller_id) continue;
        const seller = sellers.get(product.seller_id) ?? {
            sellerId: product.seller_id,
            displayName: product.seller_display_name,
            badge: product.seller_badge,
            official: product.is_official_store,
            countries: new Set<string>(),
            brands: new Set<string>(),
            products: [],
        };

        seller.displayName ??= product.seller_display_name;
        seller.badge ??= product.seller_badge;
        seller.official ||= product.is_official_store;
        if (product.country) seller.countries.add(product.country);
        seller.brands.add(product.brand ?? product.search_brand);
        seller.products.push(product);
        sellers.set(product.seller_id, seller);
    }

    return [...sellers.values()]
        .filter((seller) => seller.brands.size >= minBrandCount && seller.products.length >= minListingsPerSeller)
        .map((seller) => {
            const priced = seller.products.filter(
                (product) => product.price_amount !== null && product.price_currency !== null,
            );
            const currencies = new Set(priced.map((product) => product.price_currency as string));
            const comparable = currencies.size === 1 ? priced : [];
            const averagePrice = comparable.length
                ? Number(
                      (
                          comparable.reduce((sum, product) => sum + (product.price_amount as number), 0) /
                          comparable.length
                      ).toFixed(2),
                  )
                : null;
            const { score, qualification, reasons } = leadScore(seller);

            return {
                record_type: 'merchant_lead' as const,
                schema_version: '1.0' as const,
                seller_id: seller.sellerId,
                display_name: seller.displayName,
                seller_badge: seller.badge,
                is_official_store: seller.official,
                countries: [...seller.countries].sort(),
                brands: [...seller.brands].sort(),
                brand_count: seller.brands.size,
                listing_count: seller.products.length,
                total_likes: seller.products.reduce((sum, product) => sum + product.likes, 0),
                average_price: averagePrice,
                price_currency: currencies.size === 1 ? [...currencies][0] : null,
                sample_product_urls: [...new Set(seller.products.map((product) => product.item_url))].slice(0, 5),
                profile_url: sellerProfileUrl(seller.sellerId, market),
                lead_score: score,
                qualification,
                qualification_reasons: reasons,
                scraped_at: scrapedAt,
            };
        })
        .sort((left, right) => right.lead_score - left.lead_score || right.listing_count - left.listing_count);
}

export function countSellers(products: ProductRecord[]): number {
    return new Set(products.map((product) => product.seller_id).filter(Boolean)).size;
}
