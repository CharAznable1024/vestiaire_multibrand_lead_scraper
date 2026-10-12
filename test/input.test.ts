import { describe, expect, it } from 'vitest';

import { normalizeInput } from '../src/input.js';

describe('normalizeInput', () => {
    it('normalizes and deduplicates brands', () => {
        const input = normalizeInput({ brands: [' Gucci ', 'Gucci', 'Chanel'] });
        expect(input.brands).toEqual(['Gucci', 'Chanel']);
        expect(input.country).toBe('US');
        expect(input.maxItemsPerBrand).toBe(48);
        expect(input.dedupeMode).toBe('new_and_updated');
        expect(input.contactEnrichment).toBe(true);
        expect(input.minContactConfidence).toBe(80);
    });

    it('rejects an impossible brand threshold', () => {
        expect(() => normalizeInput({ brands: ['Gucci'], minBrandCount: 2 })).toThrow(/minBrandCount/);
    });

    it('rejects an invalid persistent store name', () => {
        expect(() => normalizeInput({ brands: ['Gucci'], minBrandCount: 1, dedupeStoreName: '../bad' })).toThrow(
            /dedupeStoreName/,
        );
    });
});
