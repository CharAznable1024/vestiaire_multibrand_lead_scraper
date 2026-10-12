# Vestiaire Multi-brand Lead Scraper

An Apify Actor that searches several brands on Vestiaire Collective, normalizes public product listings, and aggregates sellers that appear across those brands into explainable merchant leads.

The Actor is designed for operations teams: users provide brands and limits, while the Actor handles search discovery, pagination, normalization, deduplication, lead scoring, and Dataset output.

## What it does

1. Opens one public Vestiaire search page per brand with Playwright.
2. Captures the site's public product-search response in the browser session.
3. Paginates within that session, with bounded pages, retries, and concurrency.
4. Normalizes product and seller fields.
5. Groups listings by seller and calculates a lead score.
6. Reuses a named key-value store to suppress unchanged seller leads across runs.
7. Optionally discovers likely official websites and extracts publicly displayed business contacts.
8. Writes emitted seller leads to the default Dataset and a run summary to `OUTPUT` in the default key-value store.

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
| `dedupeMode` | `string` | `new_and_updated` | Emit all, only unseen sellers, or unseen and changed sellers. |
| `dedupeStoreName` | `string` | `vestiaire-multibrand-lead-state` | Persistent named KV store shared across runs. Use a different name per independent campaign. |
| `reemitAfterDays` | `integer` | `30` | Re-emit an unchanged seller after this interval; `0` disables periodic re-emission. |
| `contactEnrichment` | `boolean` | `true` | Discover likely official websites and extract public business contacts. |
| `maxContactEnrichmentLeads` | `integer` | `10` | Maximum top-scoring uncached leads searched per run. |
| `minLeadScoreForEnrichment` | `integer` | `50` | Minimum lead score required for contact enrichment. |
| `minContactConfidence` | `integer` | `80` | Minimum evidence score required for verified contacts. |
| `contactCacheDays` | `integer` | `30` | Reuse contact evidence before searching again. |
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
  "dedupeMode": "new_and_updated",
  "dedupeStoreName": "vestiaire-multibrand-lead-state",
  "reemitAfterDays": 30,
  "contactEnrichment": true,
  "maxContactEnrichmentLeads": 10,
  "minLeadScoreForEnrichment": 50,
  "minContactConfidence": 80,
  "contactCacheDays": 30,
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
- cross-run status (`new`, `updated`, `seen`), first/last-seen timestamps, and occurrence count
- verified official website, public business emails/phones, social links, evidence URLs, and contact confidence when found
- scrape timestamp and schema version

The score is a prioritization heuristic, not a factual rating of the seller. It rewards cross-brand coverage, repeated matching inventory, public seller badges, official-store status, and listing engagement.

## Cross-run deduplication

The Actor persists seller state in the named `dedupeStoreName` key-value store, keyed by Vestiaire seller ID. A stable fingerprint covers the public display name, badge, official-store flag, countries, actual listing brands, verified website, public business contacts, and social links.

- `all`: emit every qualified lead on every run.
- `new_only`: emit only seller IDs not previously stored.
- `new_and_updated` (default): emit unseen sellers and sellers whose stable fingerprint changed. Unchanged sellers can be re-emitted after `reemitAfterDays`.

State is updated even when a lead is suppressed, so `last_seen_at` and `times_seen` remain current. Independent campaigns should use different store names. Do not overlap runs that write the same state store; named KV records do not provide a transactional compare-and-swap lock.

## Public business contact enrichment

Contact enrichment is bounded and evidence-based:

1. Select the highest-scoring, business-like leads above `minLeadScoreForEnrichment`.
2. Run one page per uncached lead through `apify/google-search-scraper` to discover candidate official websites.
3. Reject marketplaces, social networks, credentialed URLs, and hosts resolving to non-public IPs.
4. Fetch the candidate homepage and up to two same-domain Contact/About pages.
5. Extract only publicly displayed `mailto:`, `tel:`, and social links.
6. Score name/domain/title/content/business-category/email-domain/contact-page evidence.

Scores at or above `minContactConfidence` are marked `verified`. Scores from 60 up to the threshold are `candidate` and do not expose contacts as verified. The Google Search Actor is a paid downstream Actor billed per search page; `maxContactEnrichmentLeads` caps this additional cost. Its optional personal-lead enrichment is explicitly disabled.

## Output records

The default Dataset contains qualified `record_type: "merchant_lead"` records. When `includeProducts` is enabled, it also contains `record_type: "product"` evidence rows. Use the Dataset `leads` and `products` views to filter them.

The default key-value store contains an `OUTPUT` record with run-level counts, failed brands, and result links.
The persistent named state store contains `STATE`, including seller fingerprints and cached contact evidence.

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
- Start contact enrichment with 3-5 leads and review confidence evidence before increasing the cap.
- Keep `maxConcurrency` between 1 and 3 for browser runs.
- Pin and regression-test Actor versions before using scheduled production tasks.
- Respect Vestiaire Collective's terms, robots policy, intellectual property, privacy requirements, and applicable law.

## Known limitations

- Vestiaire can change its public search response or Cloudflare rules without notice.
- Vestiaire search cards expose only public seller summary fields; external business contacts are available only when a high-confidence public website match succeeds.
- Website discovery depends on the downstream Google Search Actor and public websites. Generic personal names are deliberately skipped unless the Vestiaire record carries stronger business signals.
- Website contact data can change; cached evidence is refreshed after `contactCacheDays`.
- A seller may not appear in enough sampled listings to satisfy `minBrandCount`, even if they operate across multiple brands.
- Currency aggregation is only comparable within one selected market.
