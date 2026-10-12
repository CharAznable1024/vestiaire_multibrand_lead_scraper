import { describe, expect, it } from 'vitest';

import { applyCrossRunDedupe, emptyPersistentState } from '../src/dedupe.js';
import { buildLeads } from '../src/leads.js';
import type { ProductRecord } from '../src/types.js';

function lead() {
    const base: ProductRecord = {
        record_type: 'product',
        schema_version: '1.0',
        source_site: 'vestiaire_collective',
        search_brand: 'Gucci',
        item_id: 'item-1',
        title: 'Gucci bag',
        brand: 'Gucci',
        description: null,
        country: 'US',
        item_url: 'https://example.com/item-1',
        price_amount: 100,
        price_currency: 'USD',
        original_price_amount: null,
        likes: 10,
        sold: false,
        stock: true,
        colors: [],
        image_urls: [],
        seller_id: 'seller-1',
        seller_display_name: 'Sample Luxury Store',
        seller_badge: 'Trusted',
        is_official_store: false,
        seller_profile_url: 'https://example.com/profile/seller-1',
        scraped_at: '2026-10-12T00:00:00.000Z',
    };
    return buildLeads([base], 'US', 1, 1, '2026-10-12T00:00:00.000Z')[0];
}

describe('cross-run deduplication', () => {
    it('emits a new seller, suppresses an unchanged seller, and emits a changed seller', () => {
        const first = applyCrossRunDedupe(
            [lead()],
            emptyPersistentState(),
            'new_and_updated',
            30,
            '2026-10-12T00:00:00.000Z',
        );
        expect(first.emitted).toHaveLength(1);
        expect(first.emitted[0].dedupe_status).toBe('new');

        const second = applyCrossRunDedupe(
            [lead()],
            first.state,
            'new_and_updated',
            30,
            '2026-10-13T00:00:00.000Z',
        );
        expect(second.emitted).toEqual([]);
        expect(second.suppressed).toBe(1);
        expect(second.all[0].times_seen).toBe(2);

        const changedLead = {
            ...lead(),
            official_website: 'https://sampleluxurystore.com/',
            public_business_emails: ['info@sampleluxurystore.com'],
            contact_status: 'verified' as const,
            contact_confidence: 95,
        };
        const third = applyCrossRunDedupe(
            [changedLead],
            second.state,
            'new_and_updated',
            30,
            '2026-10-14T00:00:00.000Z',
        );
        expect(third.emitted).toHaveLength(1);
        expect(third.emitted[0].dedupe_status).toBe('updated');
        expect(third.emitted[0].first_seen_at).toBe('2026-10-12T00:00:00.000Z');
    });

    it('supports all and new_only modes', () => {
        const first = applyCrossRunDedupe([lead()], emptyPersistentState(), 'new_only', 0, '2026-10-12T00:00:00.000Z');
        expect(first.emitted).toHaveLength(1);
        expect(applyCrossRunDedupe([lead()], first.state, 'new_only', 0, '2026-10-13T00:00:00.000Z').emitted).toEqual([]);
        expect(applyCrossRunDedupe([lead()], first.state, 'all', 0, '2026-10-13T00:00:00.000Z').emitted).toHaveLength(1);
    });

    it('re-emits based on last emission rather than daily last-seen updates', () => {
        const first = applyCrossRunDedupe(
            [lead()],
            emptyPersistentState(),
            'new_and_updated',
            30,
            '2026-10-01T00:00:00.000Z',
        );
        const seenAgain = applyCrossRunDedupe(
            [lead()],
            first.state,
            'new_and_updated',
            30,
            '2026-10-20T00:00:00.000Z',
        );
        expect(seenAgain.emitted).toEqual([]);
        const reemitted = applyCrossRunDedupe(
            [lead()],
            seenAgain.state,
            'new_and_updated',
            30,
            '2026-11-01T00:00:00.000Z',
        );
        expect(reemitted.emitted).toHaveLength(1);
        expect(reemitted.emitted[0].dedupe_status).toBe('seen');
    });
});
