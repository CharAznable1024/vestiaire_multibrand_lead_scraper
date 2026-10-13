import { describe, expect, it } from 'vitest';

import { categoryFromProductPath, normalizeProduct } from '../src/normalize.js';

describe('normalizeProduct', () => {
    it('normalizes seller discovery evidence and category paths', () => {
        const product = normalizeProduct(
            {
                id: 61365772,
                brand: { id: 17, name: 'Louis Vuitton' },
                name: 'Neverfull leather tote',
                country: 'US',
                likes: 13,
                link: '/women-bags/handbags/louis-vuitton/item-61365772.shtml',
                price: { cents: 66200, currency: 'USD' },
                seller: { id: 32289246, firstname: 'Alexa', badge: 'Trusted', isOfficialStore: false }
            },
            'Louis Vuitton',
            'US',
        );
        expect(product).toMatchObject({
            item_id: '61365772',
            source_query: 'Louis Vuitton',
            category: 'Handbags',
            category_path: ['Women Bags', 'Handbags'],
            price_amount: 662,
            seller_id: '32289246',
        });
    });

    it('parses categories and drops malformed records', () => {
        expect(categoryFromProductPath('/men-shoes/sneakers/gucci/item.shtml')).toEqual({
            category: 'Sneakers',
            categoryPath: ['Men Shoes', 'Sneakers'],
        });
        expect(normalizeProduct({ id: 1 }, 'Gucci', 'US')).toBeNull();
    });
});
