import type { Market } from './types.js';

const HOSTS: Record<Market, string> = {
    US: 'us.vestiairecollective.com',
    GB: 'uk.vestiairecollective.com',
    FR: 'fr.vestiairecollective.com',
    DE: 'de.vestiairecollective.com',
    IT: 'it.vestiairecollective.com',
    ES: 'es.vestiairecollective.com',
};
const GLOBAL_HOST = 'www.vestiairecollective.com';

/**
 * Market-specific values are deliberately configuration, not separate crawler
 * implementations. Keep all discovery and seller-detail logic market-agnostic.
 */
const PROXY_COUNTRIES: Record<Market, string> = {
    US: 'US',
    GB: 'GB',
    FR: 'FR',
    DE: 'DE',
    IT: 'IT',
    ES: 'ES',
};

export function marketHost(market: Market): string {
    return HOSTS[market];
}

export function marketProxyCountry(market: Market): string {
    return PROXY_COUNTRIES[market];
}

export function searchUrl(brand: string, market: Market): string {
    return `https://${marketHost(market)}/search/?q=${encodeURIComponent(brand)}`;
}

export function marketCatalogUrl(market: Market): string {
    return `https://${marketHost(market)}/search/`;
}

export function globalSearchUrl(query = ''): string {
    return `https://${GLOBAL_HOST}/search/${query ? `?q=${encodeURIComponent(query)}` : ''}`;
}

/**
 * Vestiaire exposes the public Shipped From selection in its client-side
 * route, for example https://www.vestiairecollective.com/search/#country=GB.
 */
export function shippedFromSearchUrl(url: string, countryCode: string): string {
    const parsed = new URL(url);
    const hash = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash);
    hash.set('country', countryCode.toUpperCase());
    parsed.hash = hash.toString();
    return parsed.toString();
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
