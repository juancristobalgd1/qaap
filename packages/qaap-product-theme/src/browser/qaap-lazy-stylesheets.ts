// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Runtime half of the `?qaap-lazy` stylesheet convention (bundler half: the
 * `qaap-lazy-css` plugin in `examples/browser/esbuild.mjs`).
 *
 * `import url from './style/foo.css?qaap-lazy'` keeps `foo.css` out of
 * `bundle.css` and yields the URL of its own content-hashed file. {@link QaapLazyStylesheets.load}
 * attaches that file with `<link rel="stylesheet">` and resolves once it has applied, so a
 * surface can `await` it before its DOM becomes visible (no unstyled flash).
 *
 * Cascade: lazy links are inserted directly after the `bundle.css` link, in load order —
 * after every eager sheet but before styles injected at runtime (theme, Monaco, xterm) —
 * which is where the source files sat relative to each other when they were eager imports.
 */
export namespace QaapLazyStylesheets {

    const pending = new Map<string, Promise<void>>();
    let lastInserted: Element | undefined;

    /**
     * Attaches the given stylesheets (once each, in argument order) and resolves when all of
     * them have loaded. A failed load resolves too — a missing sheet degrades styling, it must
     * never wedge the surface that awaits it.
     */
    export function load(...urls: string[]): Promise<void> {
        return Promise.all(urls.map(loadOne)).then(() => undefined);
    }

    /**
     * {@link load} over `import('…css?qaap-lazy')` promises, keeping argument order. An import
     * that does not resolve is skipped: only the esbuild plugin understands `?qaap-lazy` (and the
     * bundle build fails on a specifier it cannot resolve), so this happens only outside the
     * bundle — e.g. unit tests under mocha, where Node's `require` rejects the query suffix.
     */
    export async function loadModules(...modules: Promise<{ default: string }>[]): Promise<void> {
        const urls = await Promise.all(modules.map(module => module.then(
            resolved => resolved.default,
            () => undefined,
        )));
        return load(...urls.filter((url): url is string => typeof url === 'string' && url.length > 0));
    }

    function loadOne(url: string): Promise<void> {
        let loading = pending.get(url);
        if (!loading) {
            loading = attach(url);
            pending.set(url, loading);
        }
        return loading;
    }

    /** Last resort: a link that never fires load/error must not wedge the surface awaiting it. */
    const SETTLE_TIMEOUT_MS = 15000;

    function attach(url: string): Promise<void> {
        if (typeof document === 'undefined') {
            return Promise.resolve();
        }
        const attached = findAttached(url);
        if (attached) {
            lastInserted = attached;
            return whenApplied(attached, url);
        }
        return createLink(url, undefined);
    }

    /**
     * Creates and inserts the link (directly after `retryAnchor` when retrying, else after the last
     * lazy link / the entry stylesheet) and resolves once it settles. Never rejects, never hangs.
     */
    function createLink(url: string, retryAnchor: Node | undefined): Promise<void> {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.dataset.qaapLazy = '';
        const loaded = new Promise<void>(resolve => {
            const timer = setTimeout(() => {
                console.warn(`[qaap] lazy stylesheet timed out: ${url}`);
                resolve();
            }, SETTLE_TIMEOUT_MS);
            const settle = (): void => {
                clearTimeout(timer);
                resolve();
            };
            link.onload = () => {
                link.dataset.qaapLazyState = 'loaded';
                settle();
            };
            link.onerror = () => {
                link.dataset.qaapLazyState = 'error';
                console.warn(`[qaap] lazy stylesheet failed to load: ${url}`);
                settle();
            };
        });
        const anchor = retryAnchor ?? lastInserted ?? document.querySelector(
            // The entry stylesheet: bundle.css (desktop) or bundle-mobile.css (mobile entry).
            'link[rel="stylesheet"][href*="bundle.css"], link[rel="stylesheet"][href*="bundle-mobile.css"]');
        if (anchor?.parentNode) {
            anchor.parentNode.insertBefore(link, anchor.nextSibling);
        } else {
            document.head.appendChild(link);
        }
        lastInserted = link;
        return loaded;
    }

    /**
     * A `?qaap-lazy-boot` sheet the login gate already attached with the bundle stylesheet (same
     * cascade position: directly after it, in import order). Reused instead of fetched again.
     */
    function findAttached(url: string): HTMLLinkElement | undefined {
        for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][data-qaap-lazy]'))) {
            if (link.href === url || link.getAttribute('href') === url) {
                return link;
            }
        }
        return undefined;
    }

    function whenApplied(link: HTMLLinkElement, url: string): Promise<void> {
        const state = link.dataset.qaapLazyState;
        if (state === 'loaded' || link.sheet) {
            return Promise.resolve();
        }
        if (state === 'error') {
            // The gate's link failed before we adopted it: drop it and retry once with a fresh link.
            const previous = link.previousSibling ?? undefined;
            link.remove();
            if (lastInserted === link) {
                lastInserted = previous as Element | undefined;
            }
            return createLink(url, previous);
        }
        return new Promise<void>(resolve => {
            const timer = setTimeout(() => {
                console.warn(`[qaap] lazy stylesheet timed out: ${link.href}`);
                resolve();
            }, SETTLE_TIMEOUT_MS);
            link.addEventListener('load', () => {
                clearTimeout(timer);
                resolve();
            }, { once: true });
            link.addEventListener('error', () => {
                clearTimeout(timer);
                console.warn(`[qaap] lazy stylesheet failed to load: ${link.href}`);
                resolve();
            }, { once: true });
        });
    }
}
