import { describe, expect, it } from 'vitest';

import { marketCatalogUrl } from '../src/market.js';

describe('catalog and pagination routing', () => {
    it('keeps seller-country filtering independent from a reachable discovery market', () => {
        expect(marketCatalogUrl('US')).toBe('https://us.vestiairecollective.com/search/');
    });
});
