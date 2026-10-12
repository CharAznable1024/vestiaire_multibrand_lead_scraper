import { describe, expect, it } from 'vitest';

import { testing } from '../src/contact-enrichment.js';

describe('public business contact enrichment', () => {
    it('extracts only public contact links and scores strong website evidence', () => {
        const html = `
            <html>
              <head><title>The Reluxe | Authentic Pre-Owned Luxury</title></head>
              <body>
                <h1>The Reluxe</h1>
                <p>Authentic pre-owned luxury fashion and designer resale.</p>
                <a href="mailto:help@thereluxe.com">Email customer care</a>
                <a href="tel:+15614414179">Call us</a>
                <a href="https://instagram.com/thereluxe">Instagram</a>
                <a href="/pages/contact">Contact</a>
              </body>
            </html>`;
        const page = testing.parsePage(html, 'https://thereluxe.com/');
        expect(page.emails).toEqual(['help@thereluxe.com']);
        expect(page.phones).toEqual(['+15614414179']);
        expect(page.socialUrls[0]).toContain('instagram.com/thereluxe');
        expect(page.contactUrls).toEqual(['https://thereluxe.com/pages/contact']);

        const confidence = testing.confidenceScore(
            'The Reluxe',
            { title: 'The Reluxe official website', description: 'Pre-owned luxury fashion' },
            'https://thereluxe.com/',
            [page],
        );
        expect(confidence).toBeGreaterThanOrEqual(80);
    });

    it('rejects marketplace and social URLs as official website candidates', () => {
        expect(testing.candidateUrl('https://www.vestiairecollective.com/profile/123')).toBeNull();
        expect(testing.candidateUrl('https://instagram.com/sample-store')).toBeNull();
        expect(testing.candidateUrl('https://sample-store.com/contact')).toBe('https://sample-store.com/contact');
    });
});
