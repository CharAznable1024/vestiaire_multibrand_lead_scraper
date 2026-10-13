import { describe, expect, it } from 'vitest';

import { globalSearchUrl, marketCatalogUrl, marketHost, marketProxyCountry, shippedFromSearchUrl } from '../src/market.js';

describe('market routing', () => {
    it('uses the dedicated UK Vestiaire market domain', () => {
        expect(marketHost('GB')).toBe('uk.vestiairecollective.com');
        expect(marketCatalogUrl('GB')).toBe('https://uk.vestiairecollective.com/search/');
        expect(marketProxyCountry('GB')).toBe('GB');
    });

    it('uses Vestiaire public country hash for Shipped From filters', () => {
        expect(shippedFromSearchUrl(globalSearchUrl(), 'gb')).toBe('https://www.vestiairecollective.com/search/#country=GB');
        expect(shippedFromSearchUrl(globalSearchUrl('Gucci'), 'FR')).toBe('https://www.vestiairecollective.com/search/?q=Gucci#country=FR');
    });
});
