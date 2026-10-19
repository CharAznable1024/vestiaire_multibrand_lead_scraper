import { createHash } from 'node:crypto';

import { PlaywrightCrawler } from '@crawlee/playwright';
import { Actor, log } from 'apify';
import { request as playwrightRequest, type APIRequestContext } from 'playwright';

import {
    BrightDataWebUnlocker,
    extractNextDataJson,
    extractUnlockedProductUrls,
    htmlToVisibleText,
    type BrightDataResult,
} from './bright-data.js';
import { enrichContacts } from './contact-enrichment.js';
import { applyCrossRunDedupe, normalizePersistentState } from './dedupe.js';
import { normalizeInput } from './input.js';
import { aggregateSellers, buildMerchantLeads, countSellers, merchantLeadFilterReason } from './leads.js';
import { globalSearchUrl, marketCatalogUrl, marketProxyCountry, searchUrl, sellerProfileUrl, shippedFromSearchUrl } from './market.js';
import { normalizeProduct } from './normalize.js';
import {
    captureSearchResponse,
    buildSearchTemplate,
    fetchSearchPageFromTemplateWithRetries,
    fetchSearchPageWithRetries,
    parameterizeSearchTemplate,
    storeSearchTemplate,
    type StoredSearchTemplate,
} from './search.js';
import { parseProductDetailEvidenceNextData, parseProfileStatsText, parseSellerDetailNextData } from './seller-detail.js';
import type { ActorInput, CapturedSearchResponse, ProductRecord, RawSearchResponse, RunSummary, SellerDetail } from './types.js';

await Actor.init();

const input = normalizeInput(await Actor.getInput<ActorInput>());
const startedAt = new Date().toISOString();
const searchTemplateStore = await Actor.openKeyValueStore('vestiaire-search-api-templates-v1');
const brightDataApiKey = process.env.BRIGHT_DATA_API_KEY?.trim();
const brightData = brightDataApiKey
    ? new BrightDataWebUnlocker({
          apiKey: brightDataApiKey,
          zone: process.env.BRIGHT_DATA_ZONE?.trim() || 'ebay_live_unlocker',
          country: marketProxyCountry(input.country),
          timeoutMillis: Math.max(60_000, input.navigationTimeoutSecs * 1_000),
      })
    : null;
const effectiveStartUrls =
    input.searchQueries.length === 0 && input.startUrls.length === 0
        ? [input.sellerCountries.length ? globalSearchUrl() : marketCatalogUrl(input.country)]
        : input.startUrls;
const productsById = new Map<string, ProductRecord>();
const sellerDetails = new Map<string, SellerDetail>();
const failedSources: Array<{ source: string; error: string }> = [];
const failedSellerDetails = new Set<string>();
const capturedResponses = new Map<string, Promise<CapturedSearchResponse>>();
const unlockedProductSources = new Map<string, string>();
let sellerDetailAttempted = 0;
let qualifiedLeadCount = 0;
let emittedLeadCount = 0;
let duplicateSuppressedCount = 0;
let brightDataRecoveredPages = 0;
let searchApiDirectSources = 0;
let searchApiUnblockerSources = 0;
let searchApiBrowserSources = 0;
let searchApiTemplateFallbacks = 0;
let contactEnrichmentAttempted = 0;
let contactEnrichmentVerified = 0;
let contactEnrichmentCached = 0;
let partialLeadCount = 0;
let checkpointSellerCount = 0;
let checkpointUpdatedAt: string | undefined;

function responseKey(request: { id?: string; uniqueKey: string }): string {
    return request.id ?? request.uniqueKey;
}

function searchTemplateKey(url: string): string {
    return `SOURCE_${createHash('sha256').update(url).digest('hex').slice(0, 40)}`;
}

function ingestSearchPages(pages: RawSearchResponse[], source: string): { rawItems: number; normalizedProducts: number } {
    const rawItems = pages.flatMap((result) => result.items ?? []).slice(0, input.maxListingsPerQuery);
    let normalizedProducts = 0;
    for (const rawItem of rawItems) {
        const product = normalizeProduct(rawItem, source, input.country);
        if (!product) continue;
        productsById.set(product.item_id, product);
        normalizedProducts += 1;
    }
    return { rawItems: rawItems.length, normalizedProducts };
}

async function fetchPagesFromStoredTemplate(
    template: StoredSearchTemplate,
    fetcher: typeof fetch = fetch,
): Promise<RawSearchResponse[]> {
    const timeoutMillis = input.navigationTimeoutSecs * 1_000;
    const first = await fetchSearchPageFromTemplateWithRetries(template, 0, timeoutMillis, input.maxRequestRetries, fetcher);
    const pages: RawSearchResponse[] = [first];
    const totalPages = Math.max(1, Math.trunc(first.paginationStats?.totalPages ?? 1));
    const pageLimit = Math.min(totalPages, input.maxPagesPerQuery);
    const firstPageSize = Math.max(1, first.items?.length ?? 48);
    for (let pageNumber = 1; pageNumber < pageLimit; pageNumber += 1) {
        const count = pages.reduce((sum, result) => sum + (result.items?.length ?? 0), 0);
        if (count >= input.maxListingsPerQuery) break;
        pages.push(
            await fetchSearchPageFromTemplateWithRetries(
                template,
                pageNumber * firstPageSize,
                timeoutMillis,
                input.maxRequestRetries,
                fetcher,
            ),
        );
    }
    return pages;
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
    bright_data_configured: brightData !== null,
    bright_data_request_attempts: brightData?.requestAttempts ?? 0,
    bright_data_successful_requests: brightData?.successfulRequests ?? 0,
    bright_data_recovered_pages: brightDataRecoveredPages,
    bright_data_estimated_cost_usd: brightData?.estimatedCostUsd ?? 0,
    search_api_direct_sources: searchApiDirectSources,
    search_api_unblocker_sources: searchApiUnblockerSources,
    search_api_browser_sources: searchApiBrowserSources,
    search_api_template_fallbacks: searchApiTemplateFallbacks,
    contact_enrichment_attempted: contactEnrichmentAttempted,
    contact_enrichment_verified: contactEnrichmentVerified,
    contact_enrichment_cached: contactEnrichmentCached,
    partial_lead_count: partialLeadCount,
    checkpoint_seller_count: checkpointSellerCount,
    ...(checkpointUpdatedAt ? { checkpoint_updated_at: checkpointUpdatedAt } : {}),
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
// Direct Playwright is the primary route. When Bright Data is configured,
// suppress the legacy automatic Residential route and use Web Unlocker only
// after an actual block. Explicit proxyConfiguration still takes precedence.
const useExplicitApifyProxy = !usesCustomProxyUrls && proxyInput.useApifyProxy === true;
const useApifyMarketProxy = !usesCustomProxyUrls && !useExplicitApifyProxy && input.autoMarketProxy && brightData === null;
const wantsProxy = useExplicitApifyProxy || useApifyMarketProxy || usesCustomProxyUrls;
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
if (proxyConfiguration && proxyInput.apifyProxyGroups?.includes('UNBLOCKER')) {
    // Apify Unblocker terminates TLS as a man-in-the-middle proxy. Crawlee
    // uses this flag to create Playwright pages with ignoreHTTPSErrors.
    proxyConfiguration.isManInTheMiddle = true;
}
const searchUnblockerProxyConfiguration = proxyInput.apifyProxyGroups?.includes('UNBLOCKER') && proxyConfiguration
    ? proxyConfiguration
    : await Actor.createProxyConfiguration({
          useApifyProxy: true,
          apifyProxyGroups: ['UNBLOCKER'],
          checkAccess: true,
      });
if (!searchUnblockerProxyConfiguration) throw new Error('Could not create Apify Unblocker proxy configuration');
const activeSearchUnblockerProxyConfiguration = searchUnblockerProxyConfiguration;
activeSearchUnblockerProxyConfiguration.isManInTheMiddle = true;
let searchApiRequestContext: APIRequestContext | null = null;

async function getSearchApiUnblockerFetcher(): Promise<typeof fetch> {
    if (!searchApiRequestContext) {
        const proxyUrlValue = await activeSearchUnblockerProxyConfiguration.newUrl();
        if (!proxyUrlValue) throw new Error('Apify Unblocker did not provide a proxy URL');
        const proxyUrl = new URL(proxyUrlValue);
        searchApiRequestContext = await playwrightRequest.newContext({
            ignoreHTTPSErrors: true,
            proxy: {
                server: `${proxyUrl.protocol}//${proxyUrl.host}`,
                username: decodeURIComponent(proxyUrl.username),
                password: decodeURIComponent(proxyUrl.password),
            },
        });
    }
    return async (resource, init) => {
        const response = await searchApiRequestContext!.fetch(String(resource), {
            method: init?.method,
            headers: Object.fromEntries(new Headers(init?.headers).entries()),
            data: typeof init?.body === 'string' ? init.body : undefined,
            failOnStatusCode: false,
            timeout: input.navigationTimeoutSecs * 1_000,
        });
        return new Response(new Uint8Array(await response.body()), { status: response.status(), headers: response.headers() });
    };
}

async function disposeSearchApiRequestContext(): Promise<void> {
    if (!searchApiRequestContext) return;
    await searchApiRequestContext.dispose();
    searchApiRequestContext = null;
}
log.info('Market routing configured', {
    market: input.country,
    autoMarketProxy: input.autoMarketProxy,
    autoMarketProxySuppressedByBrightData: input.autoMarketProxy && brightData !== null && !useExplicitApifyProxy,
    brightDataFallbackConfigured: brightData !== null,
    proxyMode: usesCustomProxyUrls
        ? 'custom_urls'
        : useApifyMarketProxy
          ? 'apify_market_residential'
          : useExplicitApifyProxy
            ? 'apify_datacenter_or_explicit_group'
            : 'disabled',
    proxyGroups: usesCustomProxyUrls
        ? undefined
        : useApifyMarketProxy
          ? proxyInput.apifyProxyGroups?.length
              ? proxyInput.apifyProxyGroups
              : ['RESIDENTIAL']
          : proxyInput.apifyProxyGroups,
    proxyCountry: usesCustomProxyUrls
        ? undefined
        : useApifyMarketProxy
          ? proxyInput.apifyProxyCountry ?? marketProxyCountry(input.country)
          : proxyInput.apifyProxyCountry,
});

function ingestUnlockedProductDetail(json: string, source: string, detailUrl: string): void {
    const evidence = parseProductDetailEvidenceNextData(json, source, input.country, detailUrl);
    if (!evidence) throw new Error('Unlocked product detail did not contain usable seller evidence');
    productsById.set(evidence.product.item_id, evidence.product);
    sellerDetails.set(evidence.detail.seller_id, evidence.detail);
}

async function recoverListingSourceWithBrightData(url: string, source: string): Promise<number> {
    if (!brightData) throw new Error('Bright Data fallback is not configured');
    let result: BrightDataResult;
    try {
        result = await brightData.fetch(url, { render: true, maxAttempts: 1 });
    } catch (renderedError) {
        try {
            // The non-rendered retry also exposes Bright Data policy errors
            // (for example KYC requirements) that can otherwise arrive with
            // an empty rendered body.
            result = await brightData.fetch(url, { render: false, maxAttempts: 1 });
        } catch (rawError) {
            throw new Error(`rendered request: ${String(renderedError)}; raw request: ${String(rawError)}`);
        }
    }
    const productUrls = extractUnlockedProductUrls(result.html, url).slice(0, input.maxListingsPerQuery);
    if (!productUrls.length) throw new Error('Bright Data returned HTML without Vestiaire product links');
    for (const productUrl of productUrls) unlockedProductSources.set(productUrl, source);
    brightDataRecoveredPages += 1;
    log.warning('Listing source recovered through Bright Data', {
        source,
        productUrls: productUrls.length,
        brightDataSuccessfulRequests: brightData.successfulRequests,
        brightDataEstimatedCostUsd: brightData.estimatedCostUsd,
    });
    return productUrls.length;
}

const searchCrawler = new PlaywrightCrawler({
    proxyConfiguration: proxyConfiguration ?? searchUnblockerProxyConfiguration,
    maxConcurrency: input.maxConcurrency,
    maxRequestRetries: input.maxRequestRetries,
    requestHandlerTimeoutSecs: input.navigationTimeoutSecs * 2 + 45,
    navigationTimeoutSecs: input.navigationTimeoutSecs,
    useSessionPool: true,
    persistCookiesPerSession: true,
    launchContext: {
        useIncognitoPages: true,
        ignoreProxyCertificate: true,
        launchOptions: { headless: true, args: ['--disable-gpu'] },
    },
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
        const template = storeSearchTemplate(captured);
        await searchTemplateStore.setValue(searchTemplateKey(request.url), template);
        searchApiBrowserSources += 1;
        log.info('Captured and stored Search API template', {
            source,
            endpoint: template.endpoint,
            templateKey: searchTemplateKey(request.url),
            headerNames: Object.keys(template.headers).sort(),
            payloadKeys: Object.keys(template.payload).sort(),
        });

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

        const ingested = ingestSearchPages(pages, source);
        log.info('Listing source completed', { source, ...ingested, accessMode: 'browser_capture' });
        capturedResponses.delete(key);
    },
    failedRequestHandler: async ({ request }, error) => {
        const source = String(request.userData.source);
        const directError = error instanceof Error ? error.message : String(error);
        capturedResponses.delete(responseKey(request));
        if (brightData) {
            try {
                await recoverListingSourceWithBrightData(request.url, source);
                return;
            } catch (brightDataError) {
                const message = `${directError}; Bright Data fallback failed: ${String(brightDataError)}`;
                failedSources.push({ source, error: message.slice(0, 500) });
                log.error('Listing source failed after Bright Data fallback', { source, error: message });
                return;
            }
        }
        failedSources.push({ source, error: directError.slice(0, 500) });
        log.error('Listing source failed', { source, error: directError });
    },
});

const unfilteredListingSources = [
    ...input.searchQueries.map((query) => ({
        url: input.sellerCountries.length ? globalSearchUrl(query) : searchUrl(query, input.country),
        uniqueKey: `query:${input.country}:${query.toLowerCase()}`,
        userData: { source: query, query },
    })),
    ...effectiveStartUrls.map((url) => ({
        url,
        uniqueKey: `url:${url}`,
        userData: { source: url, query: new URL(url).searchParams.get('q') ?? '' },
    })),
];
const listingSources = input.sellerCountries.length
    ? unfilteredListingSources.flatMap((source) =>
          input.sellerCountries.map((countryCode) => ({
              url: shippedFromSearchUrl(source.url, countryCode),
              uniqueKey: `${source.uniqueKey}:shipped-from:${countryCode}`,
              userData: { ...source.userData, source: `${String(source.userData.source)} [shipped from ${countryCode}]` },
          })),
      )
    : unfilteredListingSources;
const browserListingSources: typeof listingSources = [];
for (const source of listingSources) {
    const sourceName = String(source.userData.source);
    const templateKey = searchTemplateKey(source.url);
    const sourceUrl = new URL(source.url);
    if (!/^\/search\/?$/i.test(sourceUrl.pathname)) {
        browserListingSources.push(source);
        continue;
    }
    const constructedTemplate = buildSearchTemplate({
        query: String(source.userData.query ?? ''),
        sellerCountries: input.sellerCountries,
        market: input.country,
        limit: Math.max(60, Math.min(120, input.maxListingsPerQuery)),
    });
    const storedTemplate = await searchTemplateStore.getValue<StoredSearchTemplate>(templateKey);
    const template = storedTemplate
        ? parameterizeSearchTemplate(storedTemplate, {
              query: String(source.userData.query ?? ''),
              sellerCountries: input.sellerCountries,
              market: input.country,
              limit: Math.max(60, Math.min(120, input.maxListingsPerQuery)),
          })
        : constructedTemplate;
    try {
        const pages = await fetchPagesFromStoredTemplate(template);
        const ingested = ingestSearchPages(pages, sourceName);
        if (!ingested.normalizedProducts) throw new Error('Direct Search API returned no usable products');
        searchApiDirectSources += 1;
        log.info('Listing source completed', {
            source: sourceName,
            ...ingested,
            accessMode: 'direct_search_api',
            templateKey,
            templateObservedAt: template.observed_at,
        });
        continue;
    } catch (directError) {
        try {
            const unblockerFetcher = await getSearchApiUnblockerFetcher();
            const pages = await fetchPagesFromStoredTemplate(template, unblockerFetcher);
            const ingested = ingestSearchPages(pages, sourceName);
            if (!ingested.normalizedProducts) {
                throw new Error(`Unblocked Search API returned no usable products (${ingested.rawItems} raw items)`);
            }
            searchApiUnblockerSources += 1;
            await searchTemplateStore.setValue(templateKey, template);
            log.info('Listing source completed', {
                source: sourceName,
                ...ingested,
                accessMode: 'search_api_unblocker',
                templateKey,
                directError: String(directError),
            });
            continue;
        } catch (unblockerError) {
            searchApiTemplateFallbacks += 1;
            log.warning('Search API routes failed; falling back to browser capture', {
                source: sourceName,
                templateKey,
                directError: String(directError),
                unblockerError: String(unblockerError),
            });
            browserListingSources.push(source);
        }
    }
}
await disposeSearchApiRequestContext();
if (browserListingSources.length) await searchCrawler.run(browserListingSources);

if (unlockedProductSources.size > 0) {
    const fallbackProductUrls = [...unlockedProductSources.keys()].slice(0, input.maxSellerDetailCandidates);
    const unlockedDetailCrawler = new PlaywrightCrawler({
        proxyConfiguration: usesCustomProxyUrls ? proxyConfiguration : undefined,
        maxConcurrency: input.maxSellerDetailConcurrency,
        maxRequestRetries: 0,
        requestHandlerTimeoutSecs: input.navigationTimeoutSecs + 30,
        navigationTimeoutSecs: input.navigationTimeoutSecs,
        useSessionPool: true,
        persistCookiesPerSession: true,
        launchContext: {
            useIncognitoPages: true,
            ignoreProxyCertificate: true,
            launchOptions: { headless: true, args: ['--disable-gpu'] },
        },
        requestHandler: async ({ page, request }) => {
            const json = await page.locator('script#__NEXT_DATA__').textContent({ timeout: input.navigationTimeoutSecs * 1_000 });
            if (!json) throw new Error('Fallback product detail did not contain __NEXT_DATA__');
            ingestUnlockedProductDetail(json, String(request.userData.source), request.loadedUrl ?? request.url);
        },
        failedRequestHandler: async ({ request }, error) => {
            const source = String(request.userData.source);
            if (!brightData) {
                log.warning('Unlocked product evidence unavailable', { url: request.url, error: String(error) });
                return;
            }
            try {
                const result = await brightData.fetch(request.url, { render: false, maxAttempts: 2 });
                const json = extractNextDataJson(result.html);
                if (!json) throw new Error('Bright Data product detail did not contain __NEXT_DATA__');
                ingestUnlockedProductDetail(json, source, request.url);
                brightDataRecoveredPages += 1;
                log.warning('Product evidence recovered through Bright Data', {
                    url: request.url,
                    brightDataSuccessfulRequests: brightData.successfulRequests,
                });
            } catch (brightDataError) {
                log.warning('Unlocked product evidence unavailable after Bright Data fallback', {
                    url: request.url,
                    directError: String(error),
                    brightDataError: String(brightDataError),
                });
            }
        },
    });
    await unlockedDetailCrawler.run(
        fallbackProductUrls.map((url) => ({
            url,
            uniqueKey: `unlocked-product:${url}`,
            userData: { source: unlockedProductSources.get(url) },
        })),
    );
}

if (failedSources.length === listingSources.length) {
    await Actor.setValue('OUTPUT', summary('FAILED'));
    throw new Error('All listing sources failed. Review OUTPUT and run logs.');
}

if (!productsById.size) {
    await Actor.setValue('OUTPUT', summary('FAILED'));
    throw new Error('Listing sources returned no usable product evidence. Review OUTPUT and run logs.');
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
const stateStore = await Actor.openKeyValueStore(input.dedupeStoreName);
const previousState = normalizePersistentState(await stateStore.getValue('STATE'));
const streamedSellerIds = new Set<string>();
let detailCrawler: PlaywrightCrawler;
let checkpointQueue = Promise.resolve();

async function checkpointQualifiedLeadsUnsafe(): Promise<void> {
    const now = new Date().toISOString();
    const remainingSlots = Math.max(0, input.maxSellers - partialLeadCount);
    if (remainingSlots === 0) {
        await detailCrawler.autoscaledPool?.abort();
        return;
    }
    const current = buildMerchantLeads(aggregates, sellerDetails, input, input.country, now);
    const pending = current.filter((lead) => !streamedSellerIds.has(lead.seller_id));
    const checkpoint = applyCrossRunDedupe(
        pending,
        previousState,
        input.dedupeMode,
        input.reemitAfterDays,
        now,
    );
    const checkpointRecords = checkpoint.emitted.slice(0, remainingSlots);
    if (checkpointRecords.length) {
        await Actor.pushData(checkpointRecords);
        for (const lead of checkpointRecords) streamedSellerIds.add(lead.seller_id);
        partialLeadCount += checkpointRecords.length;
        log.info('Checkpointed qualified seller leads', {
            checkpointed: checkpointRecords.length,
            partialLeadCount,
            target: input.maxSellers,
        });
    }
    checkpointSellerCount = sellerDetails.size;
    checkpointUpdatedAt = now;
    await Actor.setValue('PROGRESS', {
        status: 'RUNNING',
        seller_detail_attempted: sellerDetailAttempted,
        seller_detail_succeeded: sellerDetails.size,
        seller_detail_failed: failedSellerDetails.size,
        partial_lead_count: partialLeadCount,
        checkpoint_seller_count: checkpointSellerCount,
        updated_at: now,
    });
    await Actor.setValue('OUTPUT', summary('RUNNING'));
    if (partialLeadCount >= input.maxSellers) {
        log.info('Maximum qualified seller count reached; stopping detail crawler', {
            partialLeadCount,
            target: input.maxSellers,
        });
        await detailCrawler.autoscaledPool?.abort();
    }
}

function checkpointQualifiedLeads(): Promise<void> {
    const operation = checkpointQueue.then(() => checkpointQualifiedLeadsUnsafe());
    checkpointQueue = operation.catch(() => undefined);
    return operation;
}

detailCrawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: input.maxSellerDetailConcurrency,
    maxRequestRetries: input.maxRequestRetries,
    requestHandlerTimeoutSecs: input.navigationTimeoutSecs + 30,
    navigationTimeoutSecs: input.navigationTimeoutSecs,
    useSessionPool: true,
    persistCookiesPerSession: true,
    launchContext: {
        useIncognitoPages: true,
        ignoreProxyCertificate: true,
        launchOptions: { headless: true, args: ['--disable-gpu'] },
    },
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
                let recovered = false;
                if (brightData) {
                    try {
                        const result = await brightData.fetch(profileUrl, { render: true, maxAttempts: 2 });
                        const profileStats = parseProfileStatsText(htmlToVisibleText(result.html));
                        if (!profileStats) throw new Error('Unlocked profile did not expose sold/listed counts');
                        detail.items_sold = profileStats.items_sold;
                        detail.items_listed = profileStats.items_listed;
                        detail.seller_stats_source = 'profile_page';
                        detail.seller_stats_observed_at = new Date().toISOString();
                        brightDataRecoveredPages += 1;
                        recovered = true;
                    } catch (brightDataError) {
                        log.warning('Profile statistics refresh failed after Bright Data fallback', {
                            sellerId,
                            profileUrl,
                            directError: String(error),
                            brightDataError: String(brightDataError),
                        });
                    }
                }
                if (!recovered) {
                    log.warning('Profile statistics refresh failed; using product-detail fallback', {
                        sellerId,
                        profileUrl,
                        error: String(error),
                    });
                }
            }
        }
        sellerDetails.set(sellerId, detail);
        await checkpointQualifiedLeads();
        log.info('Seller detail enriched', {
            sellerId,
            itemsSold: detail.items_sold,
            itemsListed: detail.items_listed,
            statsSource: detail.seller_stats_source,
            country: detail.seller_country,
            countryCode: detail.seller_country_code,
            segment: detail.seller_segment,
        });
    },
    failedRequestHandler: async ({ request }, error) => {
        const sellerId = String(request.userData.sellerId);
        if (brightData) {
            try {
                const result = await brightData.fetch(request.url, { render: false, maxAttempts: 2 });
                const json = extractNextDataJson(result.html);
                if (!json) throw new Error('Bright Data seller detail did not contain __NEXT_DATA__');
                const detail = parseSellerDetailNextData(json, request.url);
                if (!detail) throw new Error('Could not parse Bright Data seller detail');
                if (detail.seller_id !== sellerId) {
                    throw new Error(`Seller ID mismatch: expected ${sellerId}, got ${detail.seller_id}`);
                }
                sellerDetails.set(sellerId, detail);
                await checkpointQualifiedLeads();
                brightDataRecoveredPages += 1;
                log.warning('Seller detail recovered through Bright Data', {
                    sellerId,
                    countryCode: detail.seller_country_code,
                    brightDataSuccessfulRequests: brightData.successfulRequests,
                });
                return;
            } catch (brightDataError) {
                failedSellerDetails.add(sellerId);
                log.warning('Seller detail unavailable after Bright Data fallback', {
                    sellerId,
                    directError: String(error),
                    brightDataError: String(brightDataError),
                });
                return;
            }
        }
        failedSellerDetails.add(sellerId);
        log.warning('Seller detail unavailable', { sellerId, error: String(error) });
    },
});

await detailCrawler.run(
    aggregates
        .filter((aggregate) => !sellerDetails.has(aggregate.seller_id))
        .map((aggregate) => ({
            url: aggregate.products[0].item_url,
            uniqueKey: `seller-detail:${aggregate.seller_id}`,
            userData: { sellerId: aggregate.seller_id },
        })),
);

const scrapedAt = new Date().toISOString();
const leads = buildMerchantLeads(aggregates, sellerDetails, input, input.country, scrapedAt).slice(0, input.maxSellers);
qualifiedLeadCount = leads.length;
const qualificationFilterCounts = aggregates.reduce<Record<string, number>>((counts, aggregate) => {
    const reason = merchantLeadFilterReason(sellerDetails.get(aggregate.seller_id), input);
    if (reason) counts[reason] = (counts[reason] ?? 0) + 1;
    return counts;
}, {});
const filteredCandidateCount = Object.values(qualificationFilterCounts).reduce((sum, count) => sum + count, 0);
log.info('Seller qualification completed', {
    candidates: aggregates.length,
    qualifiedBeforeOutputCap: aggregates.length - filteredCandidateCount,
    outputAfterCap: qualifiedLeadCount,
    filtered: filteredCandidateCount,
    filterReasonCounts: qualificationFilterCounts,
});

const contactResult = await enrichContacts(leads, input, previousState, scrapedAt);
contactEnrichmentAttempted = contactResult.attempted;
contactEnrichmentVerified = contactResult.verified;
contactEnrichmentCached = contactResult.cached;
const dedupeResult = applyCrossRunDedupe(contactResult.leads, previousState, input.dedupeMode, input.reemitAfterDays, scrapedAt);
emittedLeadCount = dedupeResult.emitted.length;
duplicateSuppressedCount = dedupeResult.suppressed;
await stateStore.setValue('STATE', dedupeResult.state);

const finalRecords = dedupeResult.emitted.filter((lead) => {
    const wasCheckpointed = streamedSellerIds.has(lead.seller_id);
    return !wasCheckpointed || input.contactEnrichment;
});
if (finalRecords.length) await Actor.pushData(finalRecords);
await Actor.setValue('OUTPUT', { ...summary('SUCCEEDED'), finished_at: new Date().toISOString() });
log.info('Run completed', summary('SUCCEEDED'));
await Actor.exit();
