import { PlaywrightCrawler } from '@crawlee/playwright';
import { Actor, log } from 'apify';

import { enrichContacts } from './contact-enrichment.js';
import { applyCrossRunDedupe, normalizePersistentState } from './dedupe.js';
import { normalizeInput } from './input.js';
import { aggregateSellers, buildMerchantLeads, countSellers } from './leads.js';
import { globalSearchUrl, marketCatalogUrl, marketProxyCountry, searchUrl, sellerProfileUrl, shippedFromSearchUrl } from './market.js';
import { normalizeProduct } from './normalize.js';
import { captureSearchResponse, fetchSearchPageWithRetries } from './search.js';
import { parseProfileStatsText, parseSellerDetailNextData } from './seller-detail.js';
import type { ActorInput, CapturedSearchResponse, ProductRecord, RawSearchResponse, RunSummary, SellerDetail } from './types.js';

await Actor.init();

const input = normalizeInput(await Actor.getInput<ActorInput>());
const startedAt = new Date().toISOString();
const effectiveStartUrls =
    input.searchQueries.length === 0 && input.startUrls.length === 0
        ? [input.sellerCountries.length ? globalSearchUrl() : marketCatalogUrl(input.country)]
        : input.startUrls;
const productsById = new Map<string, ProductRecord>();
const sellerDetails = new Map<string, SellerDetail>();
const failedSources: Array<{ source: string; error: string }> = [];
const failedSellerDetails = new Set<string>();
const capturedResponses = new Map<string, Promise<CapturedSearchResponse>>();
let sellerDetailAttempted = 0;
let qualifiedLeadCount = 0;
let emittedLeadCount = 0;
let duplicateSuppressedCount = 0;
let contactEnrichmentAttempted = 0;
let contactEnrichmentVerified = 0;
let contactEnrichmentCached = 0;

function responseKey(request: { id?: string; uniqueKey: string }): string {
    return request.id ?? request.uniqueKey;
}

const summary = (status: RunSummary['status']): RunSummary => ({
    status,
    schema_version: '2.0',
    search_queries: input.searchQueries,
    start_urls: effectiveStartUrls,
    failed_sources: failedSources,
    listing_count: productsById.size,
    seller_count: countSellers([...productsById.values()]),
    seller_detail_attempted: sellerDetailAttempted,
    seller_detail_succeeded: sellerDetails.size,
    seller_detail_failed: failedSellerDetails.size,
    qualified_lead_count: qualifiedLeadCount,
    emitted_lead_count: emittedLeadCount,
    duplicate_suppressed_count: duplicateSuppressedCount,
    contact_enrichment_attempted: contactEnrichmentAttempted,
    contact_enrichment_verified: contactEnrichmentVerified,
    contact_enrichment_cached: contactEnrichmentCached,
    started_at: startedAt,
    ...(status === 'RUNNING' ? {} : { finished_at: new Date().toISOString() }),
});

Actor.on('aborting', async () => {
    log.warning('Run is aborting; persisting partial state.');
    await Actor.setValue('OUTPUT', summary('ABORTED'));
    await Actor.exit();
});

await Actor.setValue('OUTPUT', summary('RUNNING'));

const proxyInput = input.proxyConfiguration;
const usesCustomProxyUrls = (proxyInput.proxyUrls?.length ?? 0) > 0;
const useApifyMarketProxy = !usesCustomProxyUrls && (input.autoMarketProxy || proxyInput.useApifyProxy === true);
const wantsProxy = useApifyMarketProxy || usesCustomProxyUrls;
const proxyConfiguration = wantsProxy
    ? await Actor.createProxyConfiguration({
          ...proxyInput,
          ...(useApifyMarketProxy
              ? {
                    useApifyProxy: true,
                    apifyProxyGroups: proxyInput.apifyProxyGroups?.length ? proxyInput.apifyProxyGroups : ['RESIDENTIAL'],
                    apifyProxyCountry: proxyInput.apifyProxyCountry ?? marketProxyCountry(input.country),
                }
              : {}),
          checkAccess: true,
      })
    : undefined;
log.info('Market routing configured', {
    market: input.country,
    autoMarketProxy: input.autoMarketProxy,
    proxyMode: usesCustomProxyUrls ? 'custom_urls' : useApifyMarketProxy ? 'apify_market_proxy' : 'disabled',
    proxyGroups: usesCustomProxyUrls ? undefined : proxyInput.apifyProxyGroups?.length ? proxyInput.apifyProxyGroups : ['RESIDENTIAL'],
    proxyCountry: usesCustomProxyUrls ? undefined : proxyInput.apifyProxyCountry ?? marketProxyCountry(input.country),
});

const searchCrawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: input.maxConcurrency,
    maxRequestRetries: input.maxRequestRetries,
    requestHandlerTimeoutSecs: input.navigationTimeoutSecs * 2 + 45,
    navigationTimeoutSecs: input.navigationTimeoutSecs,
    useSessionPool: true,
    persistCookiesPerSession: true,
    launchContext: { launchOptions: { headless: true, args: ['--disable-gpu'] } },
    preNavigationHooks: [async ({ page, request }, gotoOptions) => {
        gotoOptions.waitUntil = 'domcontentloaded';
        const responsePromise = captureSearchResponse(page, input.navigationTimeoutSecs * 1_000);
        void responsePromise.catch(() => undefined);
        capturedResponses.set(responseKey(request), responsePromise);
    }],
    requestHandler: async ({ page, request }) => {
        const source = String(request.userData.source);
        log.info('Processing listing source', { source, url: request.loadedUrl });
        const key = responseKey(request);
        const initialSearch = await capturedResponses.get(key);
        if (!initialSearch) throw new Error(`Missing search response listener for ${source}`);
        const captured = initialSearch;

        const pages: RawSearchResponse[] = [captured.data];
        const totalPages = Math.max(1, Math.trunc(captured.data.paginationStats?.totalPages ?? 1));
        const pageLimit = Math.min(totalPages, input.maxPagesPerQuery);
        const firstPageSize = Math.max(1, captured.data.items?.length ?? 48);
        for (let pageNumber = 1; pageNumber < pageLimit; pageNumber += 1) {
            const count = pages.reduce((sum, result) => sum + (result.items?.length ?? 0), 0);
            if (count >= input.maxListingsPerQuery) break;
            try {
                pages.push(await fetchSearchPageWithRetries(page, captured, pageNumber * firstPageSize, input.maxRequestRetries));
            } catch (error) {
                log.warning('Search pagination failed; keeping successfully captured pages', {
                    source,
                    pageNumber: pageNumber + 1,
                    error: String(error),
                });
                break;
            }
        }

        const rawItems = pages.flatMap((result) => result.items ?? []).slice(0, input.maxListingsPerQuery);
        let normalizedCount = 0;
        for (const rawItem of rawItems) {
            const product = normalizeProduct(rawItem, source, input.country);
            if (!product) continue;
            productsById.set(product.item_id, product);
            normalizedCount += 1;
        }
        log.info('Listing source completed', { source, rawItems: rawItems.length, normalizedProducts: normalizedCount });
        capturedResponses.delete(key);
    },
    failedRequestHandler: async ({ request }, error) => {
        const source = String(request.userData.source);
        const message = error instanceof Error ? error.message : String(error);
        failedSources.push({ source, error: message.slice(0, 500) });
        capturedResponses.delete(responseKey(request));
        log.error('Listing source failed', { source, error: message });
    },
});

const unfilteredListingSources = [
    ...input.searchQueries.map((query) => ({
        url: input.sellerCountries.length ? globalSearchUrl(query) : searchUrl(query, input.country),
        uniqueKey: `query:${input.country}:${query.toLowerCase()}`,
        userData: { source: query },
    })),
    ...effectiveStartUrls.map((url) => ({
        url,
        uniqueKey: `url:${url}`,
        userData: { source: url },
    })),
];
const listingSources = input.sellerCountries.length
    ? unfilteredListingSources.flatMap((source) =>
          input.sellerCountries.map((countryCode) => ({
              url: shippedFromSearchUrl(source.url, countryCode),
              uniqueKey: `${source.uniqueKey}:shipped-from:${countryCode}`,
              userData: { source: `${String(source.userData.source)} [shipped from ${countryCode}]` },
          })),
      )
    : unfilteredListingSources;
await searchCrawler.run(listingSources);

if (failedSources.length === listingSources.length) {
    await Actor.setValue('OUTPUT', summary('FAILED'));
    throw new Error('All listing sources failed. Review OUTPUT and run logs.');
}

const allAggregates = aggregateSellers([...productsById.values()]);
log.info('Seller candidates prepared', {
    discovered: allAggregates.length,
    candidateLimit: input.maxSellerDetailCandidates,
    sellerCountries: input.sellerCountries,
    countryFilterStage: input.sellerCountries.length ? 'public_shipped_from_then_seller_detail' : 'seller_detail',
});
// Listing-card country is a market/listing field and is not a reliable seller
// location. Always enrich first, then filter on Seller Detail's country code.
const aggregates = allAggregates.slice(0, input.maxSellerDetailCandidates);
sellerDetailAttempted = aggregates.length;
const detailCrawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: input.maxSellerDetailConcurrency,
    maxRequestRetries: input.maxRequestRetries,
    requestHandlerTimeoutSecs: input.navigationTimeoutSecs + 30,
    navigationTimeoutSecs: input.navigationTimeoutSecs,
    useSessionPool: true,
    persistCookiesPerSession: true,
    launchContext: { launchOptions: { headless: true, args: ['--disable-gpu'] } },
    requestHandler: async ({ page, request }) => {
        const sellerId = String(request.userData.sellerId);
        const json = await page.locator('script#__NEXT_DATA__').textContent({ timeout: input.navigationTimeoutSecs * 1_000 });
        if (!json) throw new Error('Product detail did not contain __NEXT_DATA__');
        const detail = parseSellerDetailNextData(json, request.loadedUrl ?? request.url);
        if (!detail) throw new Error('Could not parse public seller statistics from product detail');
        if (detail.seller_id !== sellerId) throw new Error(`Seller ID mismatch: expected ${sellerId}, got ${detail.seller_id}`);

        if (input.refreshProfileStats) {
            const profileUrl = sellerProfileUrl(sellerId, input.country);
            try {
                const response = await page.goto(profileUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: input.navigationTimeoutSecs * 1_000,
                });
                if (response && response.status() >= 400) throw new Error(`Profile returned HTTP ${response.status()}`);
                await page.waitForTimeout(1_500);
                const profileStats = parseProfileStatsText(await page.locator('body').innerText());
                if (profileStats) {
                    detail.items_sold = profileStats.items_sold;
                    detail.items_listed = profileStats.items_listed;
                    detail.seller_stats_source = 'profile_page';
                    detail.seller_stats_observed_at = new Date().toISOString();
                } else {
                    log.warning('Profile header did not expose sold/listed counts; using product-detail fallback', { sellerId, profileUrl });
                }
            } catch (error) {
                log.warning('Profile statistics refresh failed; using product-detail fallback', {
                    sellerId,
                    profileUrl,
                    error: String(error),
                });
            }
        }
        sellerDetails.set(sellerId, detail);
        log.info('Seller detail enriched', {
            sellerId,
            itemsSold: detail.items_sold,
            itemsListed: detail.items_listed,
            statsSource: detail.seller_stats_source,
            country: detail.seller_country,
        });
    },
    failedRequestHandler: async ({ request }, error) => {
        const sellerId = String(request.userData.sellerId);
        failedSellerDetails.add(sellerId);
        log.warning('Seller detail unavailable', { sellerId, error: String(error) });
    },
});

await detailCrawler.run(
    aggregates.map((aggregate) => ({
        url: aggregate.products[0].item_url,
        uniqueKey: `seller-detail:${aggregate.seller_id}`,
        userData: { sellerId: aggregate.seller_id },
    })),
);

const scrapedAt = new Date().toISOString();
const leads = buildMerchantLeads(aggregates, sellerDetails, input, input.country, scrapedAt).slice(0, input.maxSellers);
qualifiedLeadCount = leads.length;

const stateStore = await Actor.openKeyValueStore(input.dedupeStoreName);
const previousState = normalizePersistentState(await stateStore.getValue('STATE'));
const contactResult = await enrichContacts(leads, input, previousState, scrapedAt);
contactEnrichmentAttempted = contactResult.attempted;
contactEnrichmentVerified = contactResult.verified;
contactEnrichmentCached = contactResult.cached;
const dedupeResult = applyCrossRunDedupe(contactResult.leads, previousState, input.dedupeMode, input.reemitAfterDays, scrapedAt);
emittedLeadCount = dedupeResult.emitted.length;
duplicateSuppressedCount = dedupeResult.suppressed;
await stateStore.setValue('STATE', dedupeResult.state);

if (dedupeResult.emitted.length) await Actor.pushData(dedupeResult.emitted);
await Actor.setValue('OUTPUT', { ...summary('SUCCEEDED'), finished_at: new Date().toISOString() });
log.info('Run completed', summary('SUCCEEDED'));
await Actor.exit();
