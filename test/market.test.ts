import { describe, expect, it } from 'vitest';

import { marketCatalogUrl, marketHost } from '../src/market.js';

describe('market routing', () => {
    it('uses the dedicated UK Vestiaire market domain', () => {
        expect(marketHost('GB')).toBe('uk.vestiairecollective.com');
        expect(marketCatalogUrl('GB')).toBe('https://uk.vestiairecollective.com/search/');
    });
});
