import { describe, expect, it } from 'vitest';

import { normalizeProduct } from '../src/normalize.js';

describe('normalizeProduct', () => {
    it('normalizes a Vestiaire search item', () => {
        const product = normalizeProduct(
            {
                id: 61365772,
                brand: { id: 17, name: 'Louis Vuitton' },
                name: 'Neverfull leather tote',
                description: 'Louis Vuitton Neverfull MM',
                country: 'US',
                colors: { all: [{ id: 8, name: 'Brown' }] },
                likes: 13,
                link: '/women-bags/handbags/louis-vuitton/item-61365772.shtml',
                pictures: ['/produit/61365772-1_2.jpg'],
                price: { cents: 66200, currency: 'USD' },
                discount: { originalPrice: { cents: 68500, currency: 'USD' } },
                seller: { id: 32289246, firstname: 'Alexa', badge: 'Trusted', isOfficialStore: false },
                sold: false,
                stock: false,
            },
            'Louis Vuitton',
            'US',
            '2026-10-12T00:00:00.000Z',
        );

        expect(product).toMatchObject({
            item_id: '61365772',
            brand: 'Louis Vuitton',
            price_amount: 662,
            original_price_amount: 685,
            seller_id: '32289246',
            seller_display_name: 'Alexa',
            seller_badge: 'Trusted',
            colors: ['Brown'],
        });
        expect(product?.item_url).toContain('us.vestiairecollective.com');
        expect(product?.image_urls[0]).toContain('images.vestiairecollective.com');
    });

    it('drops malformed records without an id, title, or link', () => {
        expect(normalizeProduct({ id: 1 }, 'Gucci', 'US', 'now')).toBeNull();
    });
});
