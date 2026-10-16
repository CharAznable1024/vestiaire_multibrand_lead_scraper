import { describe, expect, it } from 'vitest';

import { marketCatalogUrl } from '../src/market.js';
import { buildSearchTemplate, fetchSearchPageFromTemplate, storeSearchTemplate } from '../src/search.js';

describe('catalog and pagination routing', () => {
    it('keeps seller-country filtering independent from a reachable discovery market', () => {
        expect(marketCatalogUrl('US')).toBe('https://us.vestiairecollective.com/search/');
    });

    it('stores only forward-safe headers and replays pagination directly', async () => {
        const template = storeSearchTemplate({
            endpoint: 'https://search.vestiairecollective.com/v1/product/search',
            headers: {
                'content-type': 'application/json',
                cookie: 'private',
                authorization: 'private',
                'x-siteid': '1',
            },
            payload: { pagination: { offset: 0, limit: 48 }, filters: { country: ['GB'] } },
            data: { items: [] },
        });
        expect(template.headers).toEqual({ 'content-type': 'application/json', 'x-siteid': '1' });

        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const result = await fetchSearchPageFromTemplate(template, 48, 1_000, async (url, init) => {
            calls.push({ url: String(url), init });
            return new Response(JSON.stringify({ items: [{ id: '1' }], paginationStats: { totalPages: 2 } }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });

        expect(result.items).toHaveLength(1);
        expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ pagination: { offset: 48, limit: 48 } });
    });

    it('constructs a UK shipped-from search request without opening the page', () => {
        const template = buildSearchTemplate({ query: 'gucci', sellerCountries: ['GB'], market: 'GB', limit: 60 });
        expect(template.endpoint).toBe('https://search.vestiairecollective.com/v1/product/search');
        expect(template.headers).toMatchObject({ 'content-type': 'application/json', 'x-usecase': 'plpStandard' });
        expect(template.payload).toMatchObject({
            q: 'gucci',
            filters: { country: ['GB'] },
            locale: { country: 'US', currency: 'USD', language: 'us', sizeType: 'US' },
            pagination: { offset: 0, limit: 60 },
        });
    });
});
