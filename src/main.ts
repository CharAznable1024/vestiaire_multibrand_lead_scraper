import { PlaywrightCrawler } from '@crawlee/playwright';
import { Actor, log } from 'apify';

import { normalizeInput } from './input.js';
import { buildLeads, countSellers } from './leads.js';
import { searchUrl } from './market.js';
import { normalizeProduct } from './normalize.js';
import { captureSearchResponse, fetchSearchPage } from './search.js';
import type {
    ActorInput,
    CapturedSearchResponse,
    ProductRecord,
    RawSearchResponse,
    RunSummary,
} from './types.js';

await Actor.init();

const input = normalizeInput(await Actor.getInput<ActorInput>());
const startedAt = new Date().toISOString();
const productsById = new Map<string, ProductRecord>();
const failedBrands: Array<{ brand: string; error: string }> = [];
const capturedResponses = new Map<string, Promise<CapturedSearchResponse>>();

function responseKey(request: { id?: string; uniqueKey: string }): string {
    return request.id ?? request.uniqueKey;
}

const summary = (status: RunSummary['status']): RunSummary => ({
    status,
    schema_version: '1.0',
    searched_brands: input.brands,
    failed_brands: failedBrands,
    product_count: productsById.size,
    seller_count: countSellers([...productsById.values()]),
    qualified_lead_count: 0,
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
const wantsProxy = proxyInput.useApifyProxy || (proxyInput.proxyUrls?.length ?? 0) > 0;
const proxyConfiguration = wantsProxy
    ? await Actor.createProxyConfiguration({
          ...proxyInput,
          apifyProxyCountry: proxyInput.apifyProxyCountry ?? input.country,
          checkAccess: true,
      })
    : undefined;

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: input.maxConcurrency,
    maxRequestRetries: input.maxRequestRetries,
    requestHandlerTimeoutSecs: input.navigationTimeoutSecs + 30,
    navigationTimeoutSecs: input.navigationTimeoutSecs,
    useSessionPool: true,
    persistCookiesPerSession: true,
    launchContext: {
        launchOptions: {
            headless: true,
            args: ['--disable-gpu'],
        },
    },
    preNavigationHooks: [async ({ page, request }, gotoOptions) => {
        gotoOptions.waitUntil = 'domcontentloaded';
        const responsePromise = captureSearchResponse(page, input.navigationTimeoutSecs * 1_000);
        // A blocked navigation can close the page before requestHandler awaits this promise.
        // Attach a rejection handler immediately to prevent an unhandled rejection; the
        // original promise remains rejected and is still handled normally by requestHandler.
        void responsePromise.catch(() => undefined);
        capturedResponses.set(responseKey(request), responsePromise);
    }],
    requestHandler: async ({ page, request }) => {
        const brand = String(request.userData.brand);
        log.info('Processing brand search', { brand, url: request.loadedUrl });

        const key = responseKey(request);
        const capturedPromise = capturedResponses.get(key);
        if (!capturedPromise) throw new Error(`Missing search response listener for ${brand}`);

        const captured = await capturedPromise;
        const pages: RawSearchResponse[] = [captured.data];
        const totalPages = Math.max(1, Math.trunc(captured.data.paginationStats?.totalPages ?? 1));
        const pageLimit = Math.min(totalPages, input.maxPagesPerBrand);
        const firstPageSize = Math.max(1, captured.data.items?.length ?? 48);

        for (let pageNumber = 1; pageNumber < pageLimit; pageNumber += 1) {
            const currentCount = pages.reduce((sum, result) => sum + (result.items?.length ?? 0), 0);
            if (currentCount >= input.maxItemsPerBrand) break;
            pages.push(await fetchSearchPage(page, captured, pageNumber * firstPageSize));
        }

        const scrapedAt = new Date().toISOString();
        const rawItems = pages.flatMap((result) => result.items ?? []).slice(0, input.maxItemsPerBrand);
        let normalizedCount = 0;

        for (const rawItem of rawItems) {
            const product = normalizeProduct(rawItem, brand, input.country, scrapedAt);
            if (!product) continue;
            productsById.set(product.item_id, product);
            normalizedCount += 1;
        }

        log.info('Brand search completed', { brand, rawItems: rawItems.length, normalizedProducts: normalizedCount });
        capturedResponses.delete(key);
    },
    failedRequestHandler: async ({ request }, error) => {
        const brand = String(request.userData.brand);
        const message = error instanceof Error ? error.message : String(error);
        failedBrands.push({ brand, error: message.slice(0, 500) });
        capturedResponses.delete(responseKey(request));
        log.error('Brand search failed', { brand, error: message });
    },
});

await crawler.run(
    input.brands.map((brand) => ({
        url: searchUrl(brand, input.country),
        uniqueKey: `brand:${input.country}:${brand.toLowerCase()}`,
        userData: { brand },
    })),
);

if (failedBrands.length === input.brands.length) {
    const output = summary('FAILED');
    await Actor.setValue('OUTPUT', output);
    throw new Error('All brand searches failed. Review OUTPUT and run logs; a residential proxy may be required.');
}

const products = [...productsById.values()];
const scrapedAt = new Date().toISOString();
const leads = buildLeads(products, input.country, input.minBrandCount, input.minListingsPerSeller, scrapedAt);

if (leads.length) await Actor.pushData(leads);
if (input.includeProducts && products.length) await Actor.pushData(products);

const output: RunSummary = {
    ...summary('SUCCEEDED'),
    qualified_lead_count: leads.length,
    finished_at: new Date().toISOString(),
};
await Actor.setValue('OUTPUT', output);

log.info('Run completed', output);
await Actor.exit();
