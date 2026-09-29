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

    function attach(url: string): Promise<void> {
        if (typeof document === 'undefined') {
            return Promise.resolve();
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.dataset.qaapLazy = '';
        const loaded = new Promise<void>(resolve => {
            link.onload = () => resolve();
            link.onerror = () => {
                console.warn(`[qaap] lazy stylesheet failed to load: ${url}`);
                resolve();
            };
        });
        const anchor = lastInserted ?? document.querySelector('link[rel="stylesheet"][href*="bundle.css"]');
        if (anchor?.parentNode) {
            anchor.parentNode.insertBefore(link, anchor.nextSibling);
        } else {
            document.head.appendChild(link);
        }
        lastInserted = link;
        return loaded;
    }
}
