# Vestiaire Merchant Lead Scraper

An Apify Actor that discovers public Vestiaire seller profiles and outputs one structured merchant lead per seller. It is optimized for seller qualification rather than multi-brand overlap.

## What it collects

For every qualified seller, the Actor returns:

- public seller name, username, Seller ID, and Vestiaire profile URL
- `products_sold`, `products_listed`, bought/wished counts, and pass rate when published
- seller segment (`B2C`, `C2C`, or `UNKNOWN`), public rating badge, badges, and vacation status
- seller country and ISO country code
- categories and brands represented in the sampled listings
- sample listing count, likes, average price, and evidence URLs
- first/last seen state and cross-run change status
- optionally verified official website, public business email/phone, social links, evidence, and confidence

No login is used. The Actor processes public listing and product-detail data. It does not attempt to discover private contact information.

## How it works

1. Run the selected market's public catalog or optional `searchQueries` / filtered `startUrls`. When seller countries are specified, use Vestiaire's public **Shipped From** URL state (for example, `https://www.vestiairecollective.com/search/#country=GB`) before collecting listing cards.
2. Normalize and deduplicate listing cards by item ID.
3. Group listing evidence by Seller ID.
4. Select up to `maxSellerDetailCandidates` candidates, prioritizing sellers with more sampled listings.
5. Open one representative product detail per candidate and parse public seller statistics from `__NEXT_DATA__`.
6. Verify Shipped From results against the seller detail's actual public country code, apply sold/listed thresholds and allowed public segments, then cap Dataset rows at `maxSellers`.
7. Optionally discover and verify public business contacts.
8. Apply persistent cross-run deduplication and write one Dataset row per emitted merchant.

## Important input fields

| Field | Default | Description |
| --- | ---: | --- |
| `searchQueries` | empty | Optional brand, category, or product phrases. Empty input does not apply a brand filter. |
| `startUrls` | empty | Optional filtered Vestiaire search/category/brand URLs. |
| `country` | US | Vestiaire market domain, localized price environment, and default proxy geography. |
| `sellerCountries` | empty | Optional seller-country ISO filters. Each becomes a public **Shipped From** URL source such as `#country=GB`, then is verified from Seller Detail. United Kingdom is stored as `GB`; `UK` is accepted as an input alias. Empty means all public seller countries. |
| `maxListingsPerQuery` | 48 | Listing cards sampled per source. |
| `maxPagesPerQuery` | 1 | Pagination cap per source. |
| `maxSellers` | 25 | Maximum qualified merchant leads emitted to the Dataset. |
| `maxSellerDetailCandidates` | 100 | Maximum representative seller-detail pages inspected before seller-country and qualification filters. This is the main detail-cost cap. |
| `minItemsSold` | 5 | Minimum public `products_sold`. |
| `minItemsListed` | 1 | Minimum public `products_listed`. |
| `allowedSellerSegments` | B2C, C2C, UNKNOWN | Allowed public seller segments. |
| `requireSellerDetails` | true | Exclude sellers whose public statistics cannot be parsed. |
| `refreshProfileStats` | true | Override potentially stale product-detail sold/listed counts with the current numeric Profile header when available. |
| `autoMarketProxy` | false | Legacy compatibility option. With Bright Data configured, the Actor automatically uses Direct first and Bright Data only after a block. |
| `dedupeMode` | new_and_updated | Emit all, only new, or new and changed sellers. |
| `contactEnrichment` | true | Discover and verify public business websites and contacts. |
| `maxContactEnrichmentLeads` | 10 | Maximum paid website searches per uncached run. |

See [`input.example.json`](./input.example.json) for a complete bounded input.

When both `searchQueries` and `startUrls` are empty, the Actor automatically discovers sellers from `https://<market-domain>/search/`. Market selection and seller-location filtering are separate: `country: "GB"` chooses a localized marketplace and price context, while `sellerCountries: ["GB"]` drives Vestiaire's public **Shipped From** filter and is then verified from Seller Detail. The Actor does not treat a listing card's country as seller location. Vestiaire's public seller detail currently provides country and ISO country code, not a dependable state/province/city field.

## Output schema v2

The default Dataset contains only `merchant_lead` rows. The first columns are intentionally operational:

```text
seller_name
seller_username
profile_url
items_sold
items_listed
seller_segment
seller_country
seller_country_code
categories
brands
```

Seller category is aggregated from sampled listing URL paths and the representative detail page. It describes categories observed in this run, not the seller's complete lifetime catalog.

## Lead score

Lead score prioritizes public business evidence:

- sold volume: up to 35 points
- listed inventory: up to 20 points
- listing evidence: up to 10 points
- B2C segment: 15 points
- official-store signal: 10 points
- public seller badge: up to 10 points
- category breadth and listing engagement: up to 10 points

The score is a prioritization heuristic, not a Vestiaire rating.

## Cross-run deduplication

The default state store is `vestiaire-merchant-lead-state-v2`. State is keyed by Seller ID and fingerprints seller identity, country, segment, sold/listed counts, categories, brands, and verified contacts.

- `all`: output every qualified seller.
- `new_only`: output unseen Seller IDs.
- `new_and_updated`: output new sellers and sellers whose stable profile/statistics/contact fingerprint changed.

Changing `products_sold` is considered an update. Use a different `dedupeStoreName` for independent campaigns. Do not overlap runs writing the same store.

## Public business contact enrichment

The Actor calls `apify/google-search-scraper` for a bounded number of high-scoring, uncached merchant leads. It disables that Actor's personal-lead enrichment, rejects marketplace/social/private-network candidates, fetches public website and Contact/About pages, and extracts explicit `mailto:`, `tel:`, and social links.

This downstream Actor adds a per-search-page cost. Contact evidence is cached for `contactCacheDays`.

## Automatic access fallback

The Actor does not require operators to choose an access provider. Search discovery first constructs and posts the public Vestiaire Search API payload directly. A failed direct API request is retried through Apify UNBLOCKER; the browser is used only to refresh a missing or stale request template. Product and seller detail pages remain Direct-first and use Bright Data only after their normal retries fail.

Successful browser captures are stored in the named `vestiaire-search-api-templates-v1` key-value store. Future runs parameterize the captured template with the requested query, seller countries, market locale, and pagination offset instead of opening the search page again.

The run summary records `bright_data_request_attempts`, `bright_data_successful_requests`, `bright_data_recovered_pages`, and `bright_data_estimated_cost_usd`. Only non-empty responses without a Bright Data error header count as successful requests. The current account price is estimated at `$0.0015` per successful request.

Bright Data may reject specific domains until account KYC is completed. The Actor preserves the exact Bright Data policy error in `failed_sources` instead of reporting an empty marketplace.

## Cost controls

The main cost drivers are:

- one browser search/category page per discovery source and page
- Apify UNBLOCKER for Search API requests that fail directly; each successful request uses 10 Unblocker units
- one representative product detail per candidate seller, capped by `maxSellerDetailCandidates`
- Bright Data fallback requests only after Direct Playwright is blocked, estimated at $1.50 per 1,000 successful requests
- one downstream Google search page per uncached contact candidate, capped by `maxContactEnrichmentLeads`
- Dataset and named KV operations

Start with `maxSellers: 10-25`, `maxSellerDetailCandidates: 50-100`, and contact enrichment capped at 3-5 leads. Country-filtered campaigns may need a higher candidate cap because seller location is only known after detail enrichment.

If Vestiaire rejects search-API pagination, the Actor keeps the successfully captured first page and logs a warning. For broader discovery without brand filters, provide several category `startUrls`; each category creates an independent browser-backed first-page sample.

## Local development

```bash
npm install
npx playwright install chromium
npm test
npm run typecheck
npm run build
apify validate-schema
apify run --input-file input.example.json
```

## Deployment

```bash
apify login
apify push iMhgCHOQdXSjkmR7Z --force --build-tag latest --wait-for-finish 600
```

`git push` updates the GitHub source repository but does not deploy this Actor. Run `apify push` after pushing the tested commit; the explicit Actor ID prevents deploying to a similarly named Actor, and `--build-tag latest` makes normal Console and Bot runs use the new successful build.

Run on the Apify platform before treating changes as production-ready. Vestiaire can change public page structures or bot-protection rules without notice. Users remain responsible for website terms, privacy, intellectual property, and applicable law.
