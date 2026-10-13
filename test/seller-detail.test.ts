import { describe, expect, it } from 'vitest';

import { parseProfileStatsText, parseSellerDetailJson } from '../src/seller-detail.js';

describe('seller detail parser', () => {
    it('extracts public seller statistics, profile identity, country, and category', () => {
        const detail = parseSellerDetailJson(
            {
                props: {
                    pageProps: {
                        product: {
                            id: '62617435',
                            name: 'Ophidia bag',
                            category: { name: 'Travel bags', localized_name: 'Travel bags' },
                            seller: {
                                id: '26937465',
                                firstname: 'The Store',
                                username: 'thestore26937465',
                                country: 'United Kingdom',
                                country_i_s_o: 'GB',
                                segment: 'B2C',
                                badges: [{ name: 'Professional' }],
                                statistics: {
                                    products_sold: 34,
                                    products_listed: 120,
                                    products_bought: 2,
                                    products_wished: 5,
                                    pass_rate: 0.98
                                },
                                seller_rating: { badge: 'Expert' },
                                vacation: { active: false }
                            }
                        }
                    }
                }
            },
            'https://example.com/product',
        );
        expect(detail).toMatchObject({
            seller_id: '26937465',
            seller_username: 'thestore26937465',
            seller_segment: 'B2C',
            seller_country: 'United Kingdom',
            seller_country_code: 'GB',
            items_sold: 34,
            items_listed: 120,
            seller_badge: 'Expert',
            detail_category: 'Travel bags',
            seller_stats_source: 'product_detail',
        });
    });

    it('parses current sold/listed counts from the public profile header', () => {
        expect(parseProfileStatsText('United States\n7 items for sale\n18 sold\nUsually ships in 1-2 days')).toEqual({
            items_sold: 18,
            items_listed: 7,
        });
    });
});
