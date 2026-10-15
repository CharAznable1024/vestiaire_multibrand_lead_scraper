import { absoluteProductUrl } from './market.js';
import { categoryFromProductPath } from './normalize.js';
import type { Market, ProductRecord, SellerDetail, SellerSegment } from './types.js';

export interface ProductDetailEvidence {
    product: ProductRecord;
    detail: SellerDetail;
}

function object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function string(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

function number(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function segment(value: unknown): SellerSegment {
    const normalized = string(value)?.toUpperCase();
    return normalized === 'B2C' || normalized === 'C2C' ? normalized : 'UNKNOWN';
}

function countryCode(value: unknown, countryName: unknown): string | null {
    const normalizedName = string(countryName)?.toLowerCase().replace(/[^a-z]/g, '');
    if (
        normalizedName === 'unitedkingdom' ||
        normalizedName === 'greatbritain' ||
        normalizedName === 'england' ||
        normalizedName === 'scotland' ||
        normalizedName === 'wales' ||
        normalizedName === 'northernireland'
    ) return 'GB';

    const normalizedCode = string(value)?.toUpperCase();
    if (normalizedCode === 'UK') return 'GB';
    if (normalizedCode) return normalizedCode;

    return null;
}

function badgeNames(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => string(object(item).name) ?? string(item)).filter((item): item is string => Boolean(item)))];
}

function findProduct(data: unknown): Record<string, unknown> | null {
    const root = object(data);
    const direct = object(object(object(root.props).pageProps).product);
    if (Object.keys(direct).length) return direct;

    const visited = new Set<unknown>();
    const queue: unknown[] = [data];
    while (queue.length) {
        const current = queue.shift();
        if (!current || typeof current !== 'object' || visited.has(current)) continue;
        visited.add(current);
        const candidate = object(current);
        if (candidate.seller && candidate.id && (candidate.category || candidate.name)) return candidate;
        for (const value of Object.values(candidate)) {
            if (value && typeof value === 'object') queue.push(value);
        }
    }
    return null;
}

export function parseSellerDetailJson(value: unknown, detailSourceUrl: string): SellerDetail | null {
    const product = findProduct(value);
    if (!product) return null;
    const seller = object(product.seller);
    const sellerId = string(seller.id);
    if (!sellerId) return null;
    const statistics = object(seller.statistics);
    const sellerRating = object(seller.seller_rating ?? seller.sellerRating);
    const vacation = object(seller.vacation);
    const category = object(product.category);
    const sellerCountry = string(seller.country);

    return {
        seller_id: sellerId,
        seller_name: string(seller.firstname ?? seller.name),
        seller_username: string(seller.username),
        seller_segment: segment(seller.segment),
        seller_country: sellerCountry,
        seller_country_code: countryCode(seller.country_i_s_o ?? seller.countryISO ?? seller.countryCode, sellerCountry),
        seller_badge: string(sellerRating.badge ?? seller.badge),
        badges: badgeNames(seller.badges),
        items_sold: number(statistics.products_sold ?? statistics.productsSold),
        items_listed: number(statistics.products_listed ?? statistics.productsListed),
        items_bought: number(statistics.products_bought ?? statistics.productsBought),
        items_wished: number(statistics.products_wished ?? statistics.productsWished),
        pass_rate: number(statistics.pass_rate ?? statistics.passRate),
        vacation_active: typeof vacation.active === 'boolean' ? vacation.active : null,
        detail_category: string(category.localized_name ?? category.name),
        detail_source_url: detailSourceUrl,
        seller_stats_source: 'product_detail',
        seller_stats_observed_at: new Date().toISOString(),
    };
}

export function parseSellerDetailNextData(json: string, detailSourceUrl: string): SellerDetail | null {
    return parseSellerDetailJson(JSON.parse(json), detailSourceUrl);
}

export function parseProductDetailEvidenceJson(
    value: unknown,
    sourceQuery: string,
    market: Market,
    detailSourceUrl: string,
): ProductDetailEvidence | null {
    const product = findProduct(value);
    const detail = parseSellerDetailJson(value, detailSourceUrl);
    if (!product || !detail) return null;
    const itemId = string(product.id);
    if (!itemId) return null;
    const brand = object(product.brand);
    const price = object(product.price);
    const seller = object(product.seller);
    const cents = number(price.cents);
    const itemUrl = absoluteProductUrl(detailSourceUrl, market);
    const { category, categoryPath } = categoryFromProductPath(itemUrl);

    return {
        detail,
        product: {
            source_query: sourceQuery,
            item_id: itemId,
            title: string(product.name) ?? `Vestiaire product ${itemId}`,
            brand: string(brand.name),
            category,
            category_path: categoryPath,
            country: string(product.country),
            item_url: itemUrl,
            price_amount: cents === null ? null : cents / 100,
            price_currency: string(price.currency),
            likes: Math.max(0, Math.trunc(number(product.likes) ?? 0)),
            seller_id: detail.seller_id,
            seller_display_name: detail.seller_name,
            seller_badge: detail.seller_badge,
            is_official_store: seller.isOfficialStore === true,
        },
    };
}

export function parseProductDetailEvidenceNextData(
    json: string,
    sourceQuery: string,
    market: Market,
    detailSourceUrl: string,
): ProductDetailEvidence | null {
    return parseProductDetailEvidenceJson(JSON.parse(json), sourceQuery, market, detailSourceUrl);
}

export function parseProfileStatsText(text: string): { items_sold: number; items_listed: number } | null {
    const normalized = text.replace(/\s+/g, ' ');
    const match = normalized.match(/([\d,.]+)\s+items?\s+for\s+sale\s+([\d,.]+)\s+sold/i);
    if (!match) return null;
    const itemsListed = Number(match[1].replace(/,/g, ''));
    const itemsSold = Number(match[2].replace(/,/g, ''));
    if (!Number.isFinite(itemsListed) || !Number.isFinite(itemsSold)) return null;
    return { items_sold: itemsSold, items_listed: itemsListed };
}
