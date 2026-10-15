import { load } from 'cheerio';

export const BRIGHT_DATA_SUCCESS_COST_USD = 0.0015;

export interface BrightDataWebUnlockerOptions {
    apiKey: string;
    zone: string;
    country: string;
    timeoutMillis: number;
}

export interface BrightDataFetchOptions {
    render: boolean;
    maxAttempts?: number;
}

export interface BrightDataResult {
    html: string;
    statusCode: number;
    contentType: string | null;
}

type Fetch = typeof fetch;

export class BrightDataWebUnlocker {
    requestAttempts = 0;
    successfulRequests = 0;

    constructor(
        private readonly options: BrightDataWebUnlockerOptions,
        private readonly fetcher: Fetch = fetch,
    ) {}

    get estimatedCostUsd(): number {
        return Number((this.successfulRequests * BRIGHT_DATA_SUCCESS_COST_USD).toFixed(6));
    }

    async fetch(targetUrl: string, fetchOptions: BrightDataFetchOptions): Promise<BrightDataResult> {
        const maximum = Math.max(1, fetchOptions.maxAttempts ?? 2);
        let lastError: unknown;

        for (let attempt = 1; attempt <= maximum; attempt += 1) {
            this.requestAttempts += 1;
            try {
                const response = await this.fetcher('https://api.brightdata.com/request', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${this.options.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        zone: this.options.zone,
                        url: targetUrl,
                        format: 'raw',
                        country: this.options.country.toLowerCase(),
                        render: String(fetchOptions.render),
                    }),
                    signal: AbortSignal.timeout(this.options.timeoutMillis),
                });
                const responseText = await response.text();
                const brightDataError = response.headers.get('x-brd-error') ?? response.headers.get('x-brd-err-msg');
                if (!response.ok) {
                    throw new Error(`Bright Data returned HTTP ${response.status}: ${responseText.slice(0, 300)}`);
                }
                if (brightDataError) throw new Error(`Bright Data rejected the request: ${brightDataError}`);

                let html = responseText;
                let statusCode = response.status;
                try {
                    const envelope = JSON.parse(responseText) as { body?: unknown; status_code?: unknown };
                    if (typeof envelope.body === 'string') {
                        html = envelope.body;
                        if (typeof envelope.status_code === 'number') statusCode = envelope.status_code;
                    }
                } catch {
                    // Raw responses contain the target HTML directly.
                }
                if (statusCode >= 400) throw new Error(`Bright Data target returned HTTP ${statusCode}`);
                if (!html.trim()) throw new Error(`Bright Data returned an empty body with HTTP ${statusCode}`);
                this.successfulRequests += 1;
                return { html, statusCode, contentType: response.headers.get('content-type') };
            } catch (error) {
                lastError = error;
                if (attempt < maximum) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
            }
        }

        throw lastError;
    }
}

export function extractUnlockedProductUrls(html: string, pageUrl: string): string[] {
    const $ = load(html);
    const urls = new Set<string>();
    $('a[href]').each((_index, element) => {
        const href = $(element).attr('href');
        if (!href) return;
        try {
            const url = new URL(href, pageUrl);
            if (!/(^|\.)vestiairecollective\.com$/i.test(url.hostname)) return;
            if (!/\.shtml$/i.test(url.pathname)) return;
            url.hash = '';
            urls.add(url.toString());
        } catch {
            // Ignore malformed third-party links.
        }
    });
    return [...urls];
}

export function extractNextDataJson(html: string): string | null {
    return html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1]?.trim() || null;
}

export function htmlToVisibleText(html: string): string {
    return load(html).text().replace(/\s+/g, ' ').trim();
}
