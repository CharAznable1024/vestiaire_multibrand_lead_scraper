import { describe, expect, it } from 'vitest';

import { countryDisplayName } from '../src/shipped-from-filter.js';

describe('Shipped From country names', () => {
    it('converts ISO seller-country codes into public filter labels', () => {
        expect(countryDisplayName('GB')).toBe('United Kingdom');
        expect(countryDisplayName('fr')).toBe('France');
    });
});
