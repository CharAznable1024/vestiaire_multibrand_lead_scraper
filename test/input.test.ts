import { describe, expect, it } from 'vitest';

import { normalizeInput } from '../src/input.js';

describe('normalizeInput', () => {
    it('normalizes merchant discovery inputs and defaults', () => {
        const input = normalizeInput({ searchQueries: [' Gucci ', 'Gucci', 'handbags'] });
        expect(input.searchQueries).toEqual(['Gucci', 'handbags']);
        expect(input.maxListingsPerQuery).toBe(48);
        expect(input.maxSellers).toBe(50);
        expect(input.minItemsSold).toBe(5);
        expect(input.dedupeStoreName).toBe('vestiaire-merchant-lead-state-v2');
    });

    it('accepts filtered Vestiaire URLs and validates the host', () => {
        const input = normalizeInput({ searchQueries: [], startUrls: [{ url: 'https://us.vestiairecollective.com/women-bags/' }] });
        expect(input.startUrls).toEqual(['https://us.vestiairecollective.com/women-bags/']);
        expect(() => normalizeInput({ searchQueries: [], startUrls: [{ url: 'https://example.com/' }] })).toThrow(/Vestiaire/);
    });

    it('validates seller segments and persistent store names', () => {
        expect(() => normalizeInput({ allowedSellerSegments: ['INVALID'] })).toThrow(/allowedSellerSegments/);
        expect(() => normalizeInput({ dedupeStoreName: '../bad' })).toThrow(/dedupeStoreName/);
    });
});
