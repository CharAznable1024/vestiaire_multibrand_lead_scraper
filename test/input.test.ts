import { describe, expect, it } from 'vitest';

import { normalizeInput } from '../src/input.js';

describe('normalizeInput', () => {
    it('normalizes and deduplicates brands', () => {
        const input = normalizeInput({ brands: [' Gucci ', 'Gucci', 'Chanel'] });
        expect(input.brands).toEqual(['Gucci', 'Chanel']);
        expect(input.country).toBe('US');
        expect(input.maxItemsPerBrand).toBe(48);
    });

    it('rejects an impossible brand threshold', () => {
        expect(() => normalizeInput({ brands: ['Gucci'], minBrandCount: 2 })).toThrow(/minBrandCount/);
    });
});
