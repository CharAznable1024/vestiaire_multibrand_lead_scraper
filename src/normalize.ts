import { absoluteProductUrl, imageUrl, sellerProfileUrl } from './market.js';
import type { Market, ProductRecord } from './types.js';

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

function cents(value: unknown): number | null {
    const amount = number(value);
    return amount === null ? null : amount / 100;
}

function boolean(value: unknown): boolean {
    return value === true;
}

export function normalizeProduct(
    rawValue: unknown,
    searchBrand: string,
    market: Market,
    scrapedAt: string,
): ProductRecord | null {
    const raw = object(rawValue);
    const id = string(raw.id);
    const title = string(raw.name);
    const link = string(raw.link);
    if (!id || !title || !link) return null;

    const brand = object(raw.brand);
    const price = object(raw.price);
    const originalPrice = object(object(raw.discount).originalPrice);
    const seller = object(raw.seller);
    const colors = object(raw.colors);

    const colorNames = Array.isArray(colors.all)
        ? colors.all.map((color) => string(object(color).name)).filter((value): value is string => Boolean(value))
        : [];
    const pictures = Array.isArray(raw.pictures)
        ? raw.pictures.map(string).filter((value): value is string => Boolean(value)).map(imageUrl)
        : [];

    const sellerId = string(seller.id);
    const stock =
        typeof raw.stock === 'boolean' || typeof raw.stock === 'number' || typeof raw.stock === 'string'
            ? raw.stock
            : null;

    return {
        record_type: 'product',
        schema_version: '1.0',
        source_site: 'vestiaire_collective',
        search_brand: searchBrand,
        item_id: id,
        title,
        brand: string(brand.name),
        description: string(raw.description),
        country: string(raw.country),
        item_url: absoluteProductUrl(link, market),
        price_amount: cents(price.cents),
        price_currency: string(price.currency),
        original_price_amount: cents(originalPrice.cents),
        likes: Math.max(0, Math.trunc(number(raw.likes) ?? 0)),
        sold: boolean(raw.sold),
        stock,
        colors: [...new Set(colorNames)],
        image_urls: [...new Set(pictures)],
        seller_id: sellerId,
        seller_display_name: string(seller.firstname),
        seller_badge: string(seller.badge),
        is_official_store: boolean(seller.isOfficialStore),
        seller_profile_url: sellerId ? sellerProfileUrl(sellerId, market) : null,
        scraped_at: scrapedAt,
    };
}
