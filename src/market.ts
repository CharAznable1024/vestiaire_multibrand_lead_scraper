import type { Market } from './types.js';

const HOSTS: Record<Market, string> = {
    US: 'us.vestiairecollective.com',
    GB: 'www.vestiairecollective.com',
    FR: 'fr.vestiairecollective.com',
    DE: 'de.vestiairecollective.com',
    IT: 'it.vestiairecollective.com',
    ES: 'es.vestiairecollective.com',
};

export function marketHost(market: Market): string {
    return HOSTS[market];
}

export function searchUrl(brand: string, market: Market): string {
    return `https://${marketHost(market)}/search/?q=${encodeURIComponent(brand)}`;
}

export function absoluteProductUrl(path: string, market: Market): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `https://${marketHost(market)}${path.startsWith('/') ? path : `/${path}`}`;
}

export function imageUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `https://images.vestiairecollective.com${normalized}`;
}

export function sellerProfileUrl(sellerId: string, market: Market): string {
    return `https://${marketHost(market)}/profile/${encodeURIComponent(sellerId)}/`;
}
