import { describe, expect, it } from 'vitest';

import { buildLeads } from '../src/leads.js';
import type { ProductRecord } from '../src/types.js';

function product(
    searchBrand: string,
    itemId: string,
    likes: number,
    official = false,
    actualBrand = searchBrand,
): ProductRecord {
    return {
        record_type: 'product',
        schema_version: '1.0',
        source_site: 'vestiaire_collective',
        search_brand: searchBrand,
        item_id: itemId,
        title: `${searchBrand} item`,
        brand: actualBrand,
        description: null,
        country: 'US',
        item_url: `https://example.com/${itemId}`,
        price_amount: 100,
        price_currency: 'USD',
        original_price_amount: null,
        likes,
        sold: false,
        stock: true,
        colors: [],
        image_urls: [],
        seller_id: 'seller-1',
        seller_display_name: 'Sample Store',
        seller_badge: 'Trusted',
        is_official_store: official,
        seller_profile_url: 'https://example.com/profile/seller-1',
        scraped_at: '2026-10-12T00:00:00.000Z',
    };
}

describe('buildLeads', () => {
    it('aggregates sellers across brands and explains the score', () => {
        const leads = buildLeads(
            [product('Gucci', '1', 10), product('Chanel', '2', 20), product('Prada', '3', 5)],
            'US',
            2,
            2,
            '2026-10-12T00:00:00.000Z',
        );

        expect(leads).toHaveLength(1);
        expect(leads[0]).toMatchObject({
            seller_id: 'seller-1',
            brand_count: 3,
            listing_count: 3,
            total_likes: 35,
            average_price: 100,
            price_currency: 'USD',
        });
        expect(leads[0].qualification_reasons.join(' ')).toContain('3 searched brands');
    });

    it('filters sellers below the requested brand threshold', () => {
        const leads = buildLeads([product('Gucci', '1', 0)], 'US', 2, 1, 'now');
        expect(leads).toEqual([]);
    });

    it('uses actual listing brands rather than search phrases for multi-brand qualification', () => {
        const leads = buildLeads(
            [product('designer bag', '1', 0, false, 'Gucci'), product('luxury tote', '2', 0, false, 'Gucci')],
            'US',
            2,
            1,
            'now',
        );
        expect(leads).toEqual([]);
    });
});
