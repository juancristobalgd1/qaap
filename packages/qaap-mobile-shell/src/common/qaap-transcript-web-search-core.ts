// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface TranscriptWebSearchSite {
    readonly title: string;
    readonly url: string;
    readonly href?: string;
}

export type TranscriptWebSearchSiteState = 'pending' | 'loading' | 'done';

export interface TranscriptWebSearchPayload {
    readonly query: string;
    readonly sites: readonly TranscriptWebSearchSite[];
    readonly done: boolean;
    readonly siteStates: readonly TranscriptWebSearchSiteState[];
}

const FLATTENED_SITE_PATTERN = /([^,]+?):(https?:\/\/[^\s,]+?)(?=,\s*[^,]+:https?:\/\/|$)/gi;
const LINE_SITE_PATTERN = /^(.+?)\s*(?:\||—|–|-)\s*(https?:\/\/\S+)$/i;
/** QAIQ / OpenRouter: `**Title** — snippet… (https://example.com/path)` */
const MARKDOWN_BOLD_SITE_PATTERN = /\*\*(.+?)\*\*\s*[—–\-].*?\((https?:\/\/[^)\s]+)\)/g;
/** Claude Code style: `[Title](https://example.com/path)` */
const MARKDOWN_LINK_SITE_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const MAX_TRANSCRIPT_WEB_SEARCH_SITES = 8;

export function isTranscriptWebSearchTool(name: string | undefined): boolean {
    if (!name) {
        return false;
    }
    const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return normalized === 'websearch'
        || normalized === 'websearchtool'
        || normalized.includes('websearch');
}

export function normalizeTranscriptWebSearchDisplayUrl(raw: string): string {
    return raw
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/$/, '');
}

function resolveAbsoluteHref(raw: string): string | undefined {
    const trimmed = raw.trim();
    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }
    if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed)) {
        return `https://${trimmed}`;
    }
    return undefined;
}

function pushSite(sites: TranscriptWebSearchSite[], title: string, urlRaw: string): void {
    const titleClean = title.replace(/\s+/g, ' ').trim();
    const urlClean = urlRaw.trim();
    if (!titleClean || !urlClean) {
        return;
    }
    const href = resolveAbsoluteHref(urlClean);
    const url = normalizeTranscriptWebSearchDisplayUrl(urlClean);
    if (!url) {
        return;
    }
    if (sites.some(site => site.url === url || (href && site.href === href))) {
        return;
    }
    sites.push(href ? { title: titleClean, url, href } : { title: titleClean, url });
}

function siteFromRecord(value: unknown): TranscriptWebSearchSite | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title
        : typeof record.name === 'string' ? record.name
            : typeof record.heading === 'string' ? record.heading
                : undefined;
    const urlRaw = typeof record.url === 'string' ? record.url
        : typeof record.link === 'string' ? record.link
            : typeof record.href === 'string' ? record.href
                : undefined;
    if (!title || !urlRaw) {
        return undefined;
    }
    const href = resolveAbsoluteHref(urlRaw);
    const url = normalizeTranscriptWebSearchDisplayUrl(urlRaw);
    return href ? { title: title.trim(), url, href } : { title: title.trim(), url };
}

function parseSitesFromJson(raw: string): TranscriptWebSearchSite[] | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }
    const sites: TranscriptWebSearchSite[] = [];
    const consume = (value: unknown): void => {
        if (Array.isArray(value)) {
            for (const entry of value) {
                const site = siteFromRecord(entry);
                if (site) {
                    pushSite(sites, site.title, site.href ?? site.url);
                }
            }
            return;
        }
        if (!value || typeof value !== 'object') {
            return;
        }
        const record = value as Record<string, unknown>;
        const nested = record.results ?? record.sites ?? record.organic ?? record.items ?? record.links;
        if (nested !== undefined) {
            consume(nested);
            return;
        }
        const single = siteFromRecord(record);
        if (single) {
            pushSite(sites, single.title, single.href ?? single.url);
        }
    };
    consume(parsed);
    return sites;
}

function parseSitesFromFlattened(raw: string): TranscriptWebSearchSite[] {
    const sites: TranscriptWebSearchSite[] = [];
    FLATTENED_SITE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FLATTENED_SITE_PATTERN.exec(raw)) !== null) {
        pushSite(sites, match[1], match[2]);
    }
    return sites;
}

function parseSitesFromLines(raw: string): TranscriptWebSearchSite[] {
    const sites: TranscriptWebSearchSite[] = [];
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        const match = LINE_SITE_PATTERN.exec(trimmed);
        if (match) {
            pushSite(sites, match[1], match[2]);
        }
    }
    return sites;
}

function parseSitesFromMarkdownBold(raw: string): TranscriptWebSearchSite[] {
    const sites: TranscriptWebSearchSite[] = [];
    MARKDOWN_BOLD_SITE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MARKDOWN_BOLD_SITE_PATTERN.exec(raw)) !== null) {
        pushSite(sites, match[1], match[2]);
    }
    return sites;
}

function parseSitesFromMarkdownLinks(raw: string): TranscriptWebSearchSite[] {
    const sites: TranscriptWebSearchSite[] = [];
    MARKDOWN_LINK_SITE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MARKDOWN_LINK_SITE_PATTERN.exec(raw)) !== null) {
        pushSite(sites, match[1], match[2]);
    }
    return sites;
}

export function parseTranscriptWebSearchQuery(args: string | undefined): string {
    const raw = args?.trim();
    if (!raw) {
        return '';
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object') {
            const record = parsed as Record<string, unknown>;
            for (const key of ['query', 'search', 'q', 'input', 'text']) {
                const value = record[key];
                if (typeof value === 'string' && value.trim()) {
                    return value.trim();
                }
            }
        }
    } catch {
        // Not JSON — fall through.
    }
    return '';
}

export function parseTranscriptWebSearchSites(raw: string | undefined): TranscriptWebSearchSite[] {
    const text = raw?.trim();
    if (!text || /^ok$/i.test(text)) {
        return [];
    }
    if (/^error:/i.test(text) || /web search is unavailable/i.test(text)) {
        return [];
    }
    const fromJson = parseSitesFromJson(text);
    if (fromJson && fromJson.length > 0) {
        return fromJson.slice(0, MAX_TRANSCRIPT_WEB_SEARCH_SITES);
    }
    const fromBold = parseSitesFromMarkdownBold(text);
    if (fromBold.length > 0) {
        return fromBold.slice(0, MAX_TRANSCRIPT_WEB_SEARCH_SITES);
    }
    const fromLinks = parseSitesFromMarkdownLinks(text);
    if (fromLinks.length > 0) {
        return fromLinks.slice(0, MAX_TRANSCRIPT_WEB_SEARCH_SITES);
    }
    const flattened = parseSitesFromFlattened(text);
    if (flattened.length > 0) {
        return flattened.slice(0, MAX_TRANSCRIPT_WEB_SEARCH_SITES);
    }
    return parseSitesFromLines(text).slice(0, MAX_TRANSCRIPT_WEB_SEARCH_SITES);
}

function resolveSiteStates(
    sites: readonly TranscriptWebSearchSite[],
    done: boolean,
): readonly TranscriptWebSearchSiteState[] {
    if (sites.length === 0) {
        return [];
    }
    if (done) {
        return sites.map(() => 'done');
    }
    return sites.map((_, index) => (index === sites.length - 1 ? 'loading' : 'done'));
}

export function resolveTranscriptWebSearchPayload(segment: {
    readonly name: string;
    readonly args: string;
    readonly result?: string;
    readonly finished: boolean;
}): TranscriptWebSearchPayload {
    const query = parseTranscriptWebSearchQuery(segment.args);
    const sites = parseTranscriptWebSearchSites(segment.result);
    return {
        query,
        sites,
        done: segment.finished,
        siteStates: resolveSiteStates(sites, segment.finished),
    };
}
