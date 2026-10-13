import { absoluteProductUrl } from './market.js';
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

function humanize(segment: string): string {
    return segment
        .split('-')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

export function categoryFromProductPath(path: string): { category: string | null; categoryPath: string[] } {
    try {
        const pathname = /^https?:\/\//i.test(path) ? new URL(path).pathname : path;
        const segments = pathname.split('/').filter(Boolean);
        if (segments.length < 2 || segments[0] === 'search') return { category: null, categoryPath: [] };
        const categoryPath = segments.slice(0, 2).map(humanize);
        return { category: categoryPath.at(-1) ?? null, categoryPath };
    } catch {
        return { category: null, categoryPath: [] };
    }
}

export function normalizeProduct(
    rawValue: unknown,
    sourceQuery: string,
    market: Market,
): ProductRecord | null {
    const raw = object(rawValue);
    const id = string(raw.id);
    const title = string(raw.name);
    const link = string(raw.link);
    if (!id || !title || !link) return null;

    const brand = object(raw.brand);
    const price = object(raw.price);
    const seller = object(raw.seller);
    const sellerId = string(seller.id);
    const { category, categoryPath } = categoryFromProductPath(link);

    return {
        source_query: sourceQuery,
        item_id: id,
        title,
        brand: string(brand.name),
        category,
        category_path: categoryPath,
        country: string(raw.country),
        item_url: absoluteProductUrl(link, market),
        price_amount: number(price.cents) === null ? null : (number(price.cents) as number) / 100,
        price_currency: string(price.currency),
        likes: Math.max(0, Math.trunc(number(raw.likes) ?? 0)),
        seller_id: sellerId,
        seller_display_name: string(seller.firstname),
        seller_badge: string(seller.badge),
        is_official_store: raw.seller ? seller.isOfficialStore === true : false,
    };
}
