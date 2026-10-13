import { normalizeInput } from '../src/input.js';
import { aggregateSellers, buildMerchantLeads } from '../src/leads.js';
import type { LeadRecord, ProductRecord, SellerDetail } from '../src/types.js';

export function product(overrides: Partial<ProductRecord> = {}): ProductRecord {
    return {
        source_query: 'Gucci',
        item_id: 'item-1',
        title: 'Gucci handbag',
        brand: 'Gucci',
        category: 'Handbags',
        category_path: ['Women Bags', 'Handbags'],
        country: 'US',
        item_url: 'https://us.vestiairecollective.com/women-bags/handbags/gucci/item-1.shtml',
        price_amount: 500,
        price_currency: 'USD',
        likes: 10,
        seller_id: 'seller-1',
        seller_display_name: 'Sample Luxury Store',
        seller_badge: 'Trusted',
        is_official_store: false,
        ...overrides,
    };
}

export function sellerDetail(overrides: Partial<SellerDetail> = {}): SellerDetail {
    return {
        seller_id: 'seller-1',
        seller_name: 'Sample Luxury Store',
        seller_username: 'sampleluxurystore',
        seller_segment: 'B2C',
        seller_country: 'United States',
        seller_country_code: 'US',
        seller_badge: 'Trusted',
        badges: ['Professional'],
        items_sold: 34,
        items_listed: 120,
        items_bought: 0,
        items_wished: 2,
        pass_rate: 0.95,
        vacation_active: false,
        detail_category: 'Handbags',
        detail_source_url: 'https://us.vestiairecollective.com/item-1.shtml',
        seller_stats_source: 'product_detail',
        seller_stats_observed_at: '2026-10-12T00:00:00.000Z',
        ...overrides,
    } as SellerDetail;
}

export function merchantLead(): LeadRecord {
    const input = normalizeInput({
        searchQueries: ['Gucci'],
        minItemsSold: 0,
        minItemsListed: 0,
        contactEnrichment: false,
    });
    return buildMerchantLeads(
        aggregateSellers([product()]),
        new Map([['seller-1', sellerDetail()]]),
        input,
        'US',
        '2026-10-12T00:00:00.000Z',
    )[0];
}
