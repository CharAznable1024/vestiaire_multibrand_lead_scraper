# Vestiaire Multi-brand Lead Scraper

An Apify Actor that searches several brands on Vestiaire Collective, normalizes public product listings, and aggregates sellers that appear across those brands into explainable merchant leads.

The Actor is designed for operations teams: users provide brands and limits, while the Actor handles search discovery, pagination, normalization, deduplication, lead scoring, and Dataset output.

## What it does

1. Opens one public Vestiaire search page per brand with Playwright.
2. Captures the site's public product-search response in the browser session.
3. Paginates within that session, with bounded pages, retries, and concurrency.
4. Normalizes product and seller fields.
5. Groups listings by seller and calculates a lead score.
6. Writes qualified seller leads to the default Dataset and a run summary to `OUTPUT` in the default key-value store.

No login is used. The Actor only processes data exposed by public listing/search pages. It does not attempt to discover private contact information.

## Input

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `brands` | `string[]` | Gucci, Chanel, Louis Vuitton | Brands or search phrases to compare. |
| `country` | `string` | `US` | Market used for URLs, currency, and optional proxy geography. |
| `maxItemsPerBrand` | `integer` | `48` | Maximum listings collected for each brand. |
| `maxPagesPerBrand` | `integer` | `2` | Hard pagination cap per brand. |
| `minBrandCount` | `integer` | `2` | Minimum distinct searched brands represented by a seller. |
| `minListingsPerSeller` | `integer` | `2` | Minimum matching listings required for a lead. |
| `includeProducts` | `boolean` | `false` | Also write normalized products to the Dataset. |
| `maxConcurrency` | `integer` | `1` | Parallel browser pages. Keep low to reduce blocking. |
| `maxRequestRetries` | `integer` | `2` | Browser retry limit per brand search. |
| `navigationTimeoutSecs` | `integer` | `60` | Search-page/API response timeout. |
| `proxyConfiguration` | `object` | no proxy | Standard Apify proxy configuration. Residential proxy is recommended for stable cloud runs. |

Example:

```json
{
  "brands": ["Gucci", "Chanel", "Louis Vuitton", "Prada"],
  "country": "US",
  "maxItemsPerBrand": 96,
  "maxPagesPerBrand": 2,
  "minBrandCount": 2,
  "minListingsPerSeller": 2,
  "includeProducts": false,
  "maxConcurrency": 1,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "US"
  }
}
```

## Lead output

Each lead contains:

- seller ID, public display name, badge, and official-store flag
- countries observed in matching listings
- distinct matched brands and sample product URLs
- listing count, total likes, average price, and currency
- a `0-100` lead score, qualification (`high`, `medium`, `low`), and reasons
- scrape timestamp and schema version

The score is a prioritization heuristic, not a factual rating of the seller. It rewards cross-brand coverage, repeated matching inventory, public seller badges, official-store status, and listing engagement.

## Output records

The default Dataset contains qualified `record_type: "merchant_lead"` records. When `includeProducts` is enabled, it also contains `record_type: "product"` evidence rows. Use the Dataset `leads` and `products` views to filter them.

The default key-value store contains an `OUTPUT` record with run-level counts, failed brands, and result links.

## Local development

Requirements: Node.js 22+, Apify CLI, and Chromium for Playwright.

```bash
npm install
npx playwright install chromium
npm test
npm run build
apify validate-schema
apify run --input-file input.example.json
```

Local results are written under `storage/` and are not uploaded to Apify.

## Deployment

```bash
apify login
apify push
```

Deployment is intentionally separate from development. A platform run with the intended proxy configuration is required before treating the Actor as production-ready.

## Operational guidance

- Start with 3-5 brands and 48 listings per brand.
- Increase limits only after reviewing lead volume, duplicates, cost, and blocking rate.
- Keep `maxConcurrency` between 1 and 3 for browser runs.
- Pin and regression-test Actor versions before using scheduled production tasks.
- Respect Vestiaire Collective's terms, robots policy, intellectual property, privacy requirements, and applicable law.

## Known limitations

- Vestiaire can change its public search response or Cloudflare rules without notice.
- Search cards expose only public seller summary fields; seller bio, full stats, and external business contacts are not enriched in this MVP.
- A seller may not appear in enough sampled listings to satisfy `minBrandCount`, even if they operate across multiple brands.
- Currency aggregation is only comparable within one selected market.
