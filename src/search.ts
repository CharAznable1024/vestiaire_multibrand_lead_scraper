import type { Page, Response } from 'playwright';

import type { CapturedSearchResponse, Market, RawSearchResponse } from './types.js';

const SEARCH_ENDPOINT_FRAGMENT = 'search.vestiairecollective.com/v1/product/search';
const SEARCH_ENDPOINT = `https://${SEARCH_ENDPOINT_FRAGMENT}`;
const SEARCH_FIELDS = [
    'name', 'description', 'brand', 'model', 'country', 'price', 'discount', 'link', 'sold', 'likes',
    'editorPicks', 'shouldBeGone', 'seller', 'directShipping', 'local', 'pictures', 'colors', 'size',
    'stock', 'universeId', 'createdAt', 'dutyFree',
];
const FACET_FIELDS = [
    'brand', 'universe', 'country', 'stock', 'color', 'categoryLvl0', 'priceRange', 'price', 'condition',
    'region', 'editorPicks', 'watchMechanism', 'discount', 'sold', 'directShippingEligible',
    'directShippingCountries', 'localCountries', 'sellerBadge', 'isOfficialStore', 'materialLvl0',
    'materialLvl1', 'size0', 'size1', 'size2', 'size3', 'size4', 'size5', 'size6', 'size7', 'size8',
    'size9', 'size10', 'size11', 'size12', 'size13', 'size14', 'size15', 'size16', 'size17', 'size18',
    'size19', 'size20', 'size21', 'size22', 'size23', 'size26', 'categoryLvl1', 'categoryLvl2', 'dutyFree',
];
const MARKET_LOCALES: Record<Market, { country: string; currency: string; language: string; sizeType: string }> = {
    US: { country: 'US', currency: 'USD', language: 'us', sizeType: 'US' },
    GB: { country: 'GB', currency: 'GBP', language: 'uk', sizeType: 'UK' },
    FR: { country: 'FR', currency: 'EUR', language: 'fr', sizeType: 'FR' },
    DE: { country: 'DE', currency: 'EUR', language: 'de', sizeType: 'DE' },
    IT: { country: 'IT', currency: 'EUR', language: 'it', sizeType: 'IT' },
    ES: { country: 'ES', currency: 'EUR', language: 'es', sizeType: 'ES' },
};
const FORBIDDEN_FORWARD_HEADERS = new Set([
    'accept-encoding',
    'authorization',
    'connection',
    'content-length',
    'cookie',
    'host',
    'origin',
    'proxy-authorization',
    'referer',
    'user-agent',
    'traceparent',
    'x-deviceid',
    'x-userid',
]);

function isSearchResponse(response: Response): boolean {
    return (
        response.url().includes(SEARCH_ENDPOINT_FRAGMENT) &&
        response.request().method() === 'POST' &&
        response.status() >= 200 &&
        response.status() < 300
    );
}

export async function captureSearchResponse(page: Page, timeoutMillis: number): Promise<CapturedSearchResponse> {
    const response = await page.waitForResponse(isSearchResponse, { timeout: timeoutMillis });
    const postData = response.request().postData();
    if (!postData) throw new Error('Vestiaire search request did not contain a JSON body');

    const data = (await response.json()) as RawSearchResponse;
    const headers = await response.request().allHeaders();
    return {
        endpoint: response.url(),
        headers,
        payload: JSON.parse(postData) as Record<string, unknown>,
        data,
    };
}

export interface StoredSearchTemplate {
    endpoint: string;
    headers: Record<string, string>;
    payload: Record<string, unknown>;
    observed_at: string;
}

export interface SearchTemplateInput {
    query: string;
    sellerCountries: string[];
    market: Market;
    limit?: number;
}

export function buildSearchTemplate(input: SearchTemplateInput): StoredSearchTemplate {
    return {
        endpoint: SEARCH_ENDPOINT,
        headers: {
            accept: 'application/json',
            'accept-language': input.market === 'US' ? 'en-US' : 'en-GB',
            'content-type': 'application/json',
            'x-datadog-origin': 'rum',
            'x-usecase': 'plpStandard',
        },
        payload: {
            pagination: { offset: 0, limit: input.limit ?? 60 },
            fields: SEARCH_FIELDS,
            facets: { fields: FACET_FIELDS, stats: ['price'] },
            q: input.query,
            sortBy: 'relevance',
            filters: input.sellerCountries.length ? { country: input.sellerCountries } : {},
            locale: MARKET_LOCALES[input.market],
            mySizes: null,
            options: {
                innerFeedContext: 'genericPLP',
                disableHierarchicalParentFiltering: true,
                enableGuidedSearch: true,
            },
            recentlyViewedProductIDs: [],
        },
        observed_at: new Date().toISOString(),
    };
}

export function parameterizeSearchTemplate(
    template: StoredSearchTemplate,
    input: SearchTemplateInput,
): StoredSearchTemplate {
    const constructed = buildSearchTemplate(input);
    return {
        endpoint: template.endpoint || constructed.endpoint,
        headers: { ...constructed.headers, ...forwardedHeaders(template.headers) },
        payload: {
            ...structuredClone(template.payload),
            q: constructed.payload.q,
            filters: constructed.payload.filters,
            locale: constructed.payload.locale,
            pagination: constructed.payload.pagination,
        },
        observed_at: template.observed_at,
    };
}

function forwardedHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).filter(
            ([name, value]) =>
                /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) &&
                !FORBIDDEN_FORWARD_HEADERS.has(name.toLowerCase()) &&
                !name.toLowerCase().startsWith('sec-') &&
                !name.toLowerCase().startsWith('x-datadog-') &&
                !name.toLowerCase().startsWith('x-search-') &&
                !/[\r\n]/.test(value),
        ),
    );
}

function payloadWithOffset(payloadValue: Record<string, unknown>, offset: number): Record<string, unknown> {
    const payload = structuredClone(payloadValue);
    const pagination =
        payload.pagination && typeof payload.pagination === 'object' && !Array.isArray(payload.pagination)
            ? (payload.pagination as Record<string, unknown>)
            : {};
    pagination.offset = offset;
    payload.pagination = pagination;
    return payload;
}

export function storeSearchTemplate(captured: CapturedSearchResponse): StoredSearchTemplate {
    return {
        endpoint: captured.endpoint,
        headers: forwardedHeaders(captured.headers),
        payload: structuredClone(captured.payload),
        observed_at: new Date().toISOString(),
    };
}

export async function fetchSearchPageFromTemplate(
    template: StoredSearchTemplate,
    offset: number,
    timeoutMillis: number,
    fetcher: typeof fetch = fetch,
): Promise<RawSearchResponse> {
    const response = await fetcher(template.endpoint, {
        method: 'POST',
        headers: template.headers,
        body: JSON.stringify(payloadWithOffset(template.payload, offset)),
        signal: AbortSignal.timeout(timeoutMillis),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Direct Search API returned HTTP ${response.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text) as RawSearchResponse;
    if (!Array.isArray(data.items)) throw new Error('Direct Search API response did not contain an items array');
    return data;
}

export async function fetchSearchPageFromTemplateWithRetries(
    template: StoredSearchTemplate,
    offset: number,
    timeoutMillis: number,
    maxRetries: number,
    fetcher: typeof fetch = fetch,
): Promise<RawSearchResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            return await fetchSearchPageFromTemplate(template, offset, timeoutMillis, fetcher);
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
        }
    }
    throw lastError;
}

export async function fetchSearchPage(
    page: Page,
    captured: CapturedSearchResponse,
    offset: number,
): Promise<RawSearchResponse> {
    const response = await page.request.post(captured.endpoint, {
        headers: forwardedHeaders(captured.headers),
        data: payloadWithOffset(captured.payload, offset),
        failOnStatusCode: false,
        timeout: 60_000,
    });
    const text = await response.text();
    if (!response.ok()) throw new Error(`Search API returned HTTP ${response.status()}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as RawSearchResponse;
}

export async function fetchSearchPageWithRetries(
    page: Page,
    captured: CapturedSearchResponse,
    offset: number,
    maxRetries: number,
): Promise<RawSearchResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            return await fetchSearchPage(page, captured, offset);
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) await page.waitForTimeout(750 * (attempt + 1));
        }
    }
    throw lastError;
}
