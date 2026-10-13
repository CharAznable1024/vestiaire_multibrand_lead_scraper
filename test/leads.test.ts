import { describe, expect, it } from 'vitest';

import { normalizeInput } from '../src/input.js';
import { aggregateSellers, buildMerchantLeads } from '../src/leads.js';
import { product, sellerDetail } from './fixtures.js';

describe('merchant lead aggregation', () => {
    it('outputs seller sales, profile, categories, region, and inventory', () => {
        const products = [
            product(),
            product({ item_id: 'item-2', brand: 'Chanel', category: 'Jackets', source_query: 'Chanel', item_url: 'https://example.com/item-2' }),
        ];
        const aggregates = aggregateSellers(products);
        const input = normalizeInput({ searchQueries: ['Gucci'], minItemsSold: 5, minItemsListed: 1 });
        const leads = buildMerchantLeads(
            aggregates,
            new Map([['seller-1', sellerDetail()]]),
            input,
            'US',
            '2026-10-12T00:00:00.000Z',
        );
        expect(leads).toHaveLength(1);
        expect(leads[0]).toMatchObject({
            schema_version: '2.0',
            seller_name: 'Sample Luxury Store',
            seller_username: 'sampleluxurystore',
            seller_segment: 'B2C',
            seller_country: 'United States',
            seller_country_code: 'US',
            items_sold: 34,
            items_listed: 120,
            categories: ['Handbags', 'Jackets'],
            sample_listing_count: 2,
        });
        expect(leads[0].profile_url).toContain('/profile/seller-1/');
        expect(leads[0].qualification_reasons.join(' ')).toContain('34 public items sold');
    });

    it('filters sellers below the public sold threshold or without required details', () => {
        const aggregates = aggregateSellers([product()]);
        const strict = normalizeInput({ searchQueries: ['Gucci'], minItemsSold: 50 });
        expect(buildMerchantLeads(aggregates, new Map([['seller-1', sellerDetail()]]), strict, 'US', 'now')).toEqual([]);
        expect(buildMerchantLeads(aggregates, new Map(), strict, 'US', 'now')).toEqual([]);
    });

    it('filters by seller-detail country rather than listing-card country', () => {
        const input = normalizeInput({ sellerCountries: ['GB'], minItemsSold: 0, minItemsListed: 0 });
        const aggregates = aggregateSellers([product({ country: 'US' })]);
        const details = new Map([['seller-1', sellerDetail({ seller_country: 'United Kingdom', seller_country_code: 'GB' })]]);

        expect(buildMerchantLeads(aggregates, details, input, 'GB', 'now')).toHaveLength(1);
    });
});
