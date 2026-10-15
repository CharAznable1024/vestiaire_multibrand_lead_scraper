import { describe, expect, it } from 'vitest';

import { BrightDataWebUnlocker, extractNextDataJson, extractUnlockedProductUrls } from '../src/bright-data.js';

describe('Bright Data fallback', () => {
    it('counts successful requests and estimates successful-result cost', async () => {
        const client = new BrightDataWebUnlocker(
            { apiKey: 'test', zone: 'zone', country: 'GB', timeoutMillis: 1_000 },
            async () => new Response('<html><body>ok</body></html>', { status: 200 }),
        );

        await expect(client.fetch('https://example.com', { render: true, maxAttempts: 1 })).resolves.toMatchObject({
            statusCode: 200,
        });
        expect(client.requestAttempts).toBe(1);
        expect(client.successfulRequests).toBe(1);
        expect(client.estimatedCostUsd).toBe(0.0015);
    });

    it('surfaces Bright Data policy errors without counting them as successes', async () => {
        const client = new BrightDataWebUnlocker(
            { apiKey: 'test', zone: 'zone', country: 'GB', timeoutMillis: 1_000 },
            async () => new Response('blocked', { status: 200, headers: { 'x-brd-error': 'KYC required' } }),
        );

        await expect(client.fetch('https://example.com', { render: true, maxAttempts: 1 })).rejects.toThrow(/KYC required/);
        expect(client.requestAttempts).toBe(1);
        expect(client.successfulRequests).toBe(0);
    });

    it('extracts unique Vestiaire product links and Next data', () => {
        const html = `
            <a href="/women-bags/handbags/gucci/example-123.shtml">one</a>
            <a href="https://uk.vestiairecollective.com/women-bags/handbags/gucci/example-123.shtml#details">duplicate</a>
            <a href="https://example.com/not-vestiaire.shtml">ignore</a>
            <script id="__NEXT_DATA__">{"ok":true}</script>
        `;

        expect(extractUnlockedProductUrls(html, 'https://uk.vestiairecollective.com/search/')).toEqual([
            'https://uk.vestiairecollective.com/women-bags/handbags/gucci/example-123.shtml',
        ]);
        expect(extractNextDataJson(html)).toBe('{"ok":true}');
    });
});
