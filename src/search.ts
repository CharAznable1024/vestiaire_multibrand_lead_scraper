import type { Page, Response } from 'playwright';

import type { CapturedSearchResponse, RawSearchResponse } from './types.js';

const SEARCH_ENDPOINT_FRAGMENT = 'search.vestiairecollective.com/v1/product/search';
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

function forwardedHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).filter(
            ([name, value]) =>
                /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) &&
                !FORBIDDEN_FORWARD_HEADERS.has(name.toLowerCase()) &&
                !name.toLowerCase().startsWith('sec-') &&
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
