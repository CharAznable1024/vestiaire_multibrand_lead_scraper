import type { Page, Response } from 'playwright';

import type { CapturedSearchResponse, RawSearchResponse } from './types.js';

const SEARCH_ENDPOINT_FRAGMENT = 'search.vestiairecollective.com/v1/product/search';
const FORBIDDEN_FORWARD_HEADERS = new Set([
    'accept-encoding',
    'connection',
    'content-length',
    'cookie',
    'host',
    'origin',
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

function forwardedHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).filter(
            ([name]) => !FORBIDDEN_FORWARD_HEADERS.has(name.toLowerCase()) && !name.toLowerCase().startsWith('sec-'),
        ),
    );
}

export async function fetchSearchPage(
    page: Page,
    captured: CapturedSearchResponse,
    offset: number,
): Promise<RawSearchResponse> {
    const payload = structuredClone(captured.payload);
    const pagination =
        payload.pagination && typeof payload.pagination === 'object' && !Array.isArray(payload.pagination)
            ? (payload.pagination as Record<string, unknown>)
            : {};
    pagination.offset = offset;
    payload.pagination = pagination;

    const result = await page.evaluate(
        async ({ endpoint, headers, body }) => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                credentials: 'include',
                body: JSON.stringify(body),
            });
            const text = await response.text();
            if (!response.ok) throw new Error(`Search API returned HTTP ${response.status}: ${text.slice(0, 200)}`);
            return JSON.parse(text) as RawSearchResponse;
        },
        { endpoint: captured.endpoint, headers: forwardedHeaders(captured.headers), body: payload },
    );

    return result;
}
