import type { Page } from 'playwright';

import { captureSearchResponse } from './search.js';
import type { CapturedSearchResponse } from './types.js';

export function countryDisplayName(countryCode: string): string {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode.toUpperCase());
    if (!name) throw new Error(`Unsupported seller country code: ${countryCode}`);
    return name;
}

/**
 * Applies Vestiaire's public "Shipped From" search UI. The response generated
 * by the UI becomes the pagination template, so later API page requests retain
 * the same seller-origin filter without relying on undocumented field names.
 */
export async function applyShippedFromFilter(
    page: Page,
    sellerCountries: string[],
    timeoutMillis: number,
): Promise<CapturedSearchResponse> {
    if (!sellerCountries.length) throw new Error('At least one seller country is required');

    let filterButton = page.locator('[data-cy="CATALOG.FILTERS.LOCATION.BUTTON"]').first();
    if ((await filterButton.count()) === 0) filterButton = page.getByRole('button', { name: /shipped from/i }).first();
    if ((await filterButton.count()) === 0) throw new Error('The public Shipped From filter was not available on this search page');

    await filterButton.scrollIntoViewIfNeeded();
    // Vestiaire can render a transparent sticky layer over the filter toolbar.
    // The public button is already resolved above, so bypass only that layer.
    await filterButton.click({ force: true, timeout: Math.min(timeoutMillis, 10_000) });

    const options = [];
    for (const countryCode of sellerCountries) {
        const countryName = countryDisplayName(countryCode);
        const option = page.getByText(countryName, { exact: true }).last();
        if ((await option.count()) === 0) throw new Error(`Shipped From does not offer ${countryName}`);
        options.push(option);
    }

    const responsePromise = captureSearchResponse(page, timeoutMillis);
    for (const option of options) await option.click();

    const applyButton = page.getByRole('button', { name: /^apply$/i }).last();
    if ((await applyButton.count()) > 0 && (await applyButton.isVisible())) await applyButton.click();

    return responsePromise;
}
