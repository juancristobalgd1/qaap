// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-check
'use strict';
/**
 * Shared helpers for the frontend bundle scripts (`qaap-frontend-graph-report.js`,
 * `qaap-mobile-bundle-guard.js`). They read the esbuild metafile that
 * `examples/browser/esbuild.mjs` writes to `lib/.qaap-frontend-metafile.json`.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_METAFILE = path.join(repoRoot, 'examples', 'browser', 'lib', '.qaap-frontend-metafile.json');
const FRONTEND_DIR = path.join(repoRoot, 'examples', 'browser', 'lib', 'frontend');

/**
 * @param {string} [file]
 * @returns {{ inputs: Record<string, any>, outputs: Record<string, any> }}
 */
function readMetafile(file = DEFAULT_METAFILE) {
    if (!fs.existsSync(file)) {
        throw new Error(`metafile not found: ${path.relative(repoRoot, file)} (run \`npm run build:browser\` first)`);
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Package that owns an input path: the last `node_modules/<pkg>` segment for installed code, else
 * `@theia/<dir>` for in-repo `packages/<dir>/...` (esbuild reports symlink-resolved paths, so
 * `node_modules/@theia/x` shows up as `../../packages/x`), else the first path segment.
 * @param {string} input
 * @returns {string}
 */
function packageOf(input) {
    const normalized = input.replace(/\\/g, '/');
    const nm = normalized.lastIndexOf('node_modules/');
    if (nm !== -1) {
        const rest = normalized.slice(nm + 'node_modules/'.length).split('/');
        return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
    }
    const match = /(?:^|\/)packages\/([^/]+)\//.exec(normalized);
    if (match) {
        return `@theia/${match[1]}`;
    }
    const dev = /(?:^|\/)dev-packages\/([^/]+)\//.exec(normalized);
    if (dev) {
        return `@theia/${dev[1]}`;
    }
    if (/(^|\/)src-gen\//.test(normalized)) {
        return '(generated src-gen)';
    }
    return normalized.split('/').filter(part => part && part !== '..')[0] || '(unknown)';
}

/** @param {string} output */
function isJsOrCss(output) {
    return /\.(?:js|css)$/.test(output);
}

/**
 * Output files reachable from `entryOutput` through output-level imports (static and dynamic).
 * In production `require` is inlined, so an entry is a single file and the closure is `{entry}`.
 * @param {{ outputs: Record<string, any> }} meta
 * @param {string} entryOutput
 * @returns {Set<string>}
 */
function outputClosure(meta, entryOutput) {
    const seen = new Set();
    const queue = [entryOutput];
    while (queue.length) {
        const current = queue.pop();
        if (seen.has(current) || !meta.outputs[current]) {
            continue;
        }
        seen.add(current);
        for (const imported of meta.outputs[current].imports || []) {
            if (!imported.external) {
                queue.push(imported.path);
            }
        }
        const css = meta.outputs[current].cssBundle;
        if (css) {
            queue.push(css);
        }
    }
    return seen;
}

/**
 * @param {{ outputs: Record<string, any> }} meta
 * @returns {Array<[string, any]>} configured entry outputs. esbuild also tags every dynamic-import
 * target (`chunk-*`) with an `entryPoint` in development, so those are filtered out by name.
 */
function entryOutputs(meta) {
    return Object.entries(meta.outputs)
        .filter(([output, info]) => info.entryPoint && isJsOrCss(output) && !/^chunk-/.test(path.basename(output)));
}

/**
 * Entry name from an output path: `.../lib/frontend/bundle-mobile.js` -> `bundle-mobile`.
 * @param {string} output
 */
function entryName(output) {
    return path.basename(output).replace(/\.(?:js|css)$/, '');
}

/**
 * Shortest import chains (BFS over the input graph) from `entryInput` to every input accepted by
 * `matches`. The key of the returned map is whatever `keyOf` returns; only the first (shortest)
 * chain per key is kept.
 * @param {{ inputs: Record<string, any> }} meta
 * @param {string} entryInput
 * @param {(input: string) => string | undefined} keyOf
 * @returns {{ chains: Map<string, string[]>, reachable: Set<string> }}
 */
function shortestChains(meta, entryInput, keyOf) {
    /** @type {Map<string, string | undefined>} */
    const parent = new Map([[entryInput, undefined]]);
    const queue = [entryInput];
    /** @type {Map<string, string[]>} */
    const chains = new Map();
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        const key = keyOf(current);
        if (key !== undefined && !chains.has(key)) {
            const chain = [];
            for (let node = current; node !== undefined; node = /** @type {string} */ (parent.get(node))) {
                chain.push(node);
            }
            chains.set(key, chain.reverse());
        }
        for (const imported of meta.inputs[current]?.imports || []) {
            if (imported.external || parent.has(imported.path) || !meta.inputs[imported.path]) {
                continue;
            }
            parent.set(imported.path, current);
            queue.push(imported.path);
        }
    }
    return { chains, reachable: new Set(parent.keys()) };
}

/**
 * Collapse a file chain into consecutive package hops: `a/x.js, a/y.js, b/z.js` -> `a > b`.
 * @param {string[]} chain
 * @returns {string[]}
 */
function packageHops(chain) {
    const hops = [];
    for (const input of chain) {
        const pkg = packageOf(input);
        if (hops[hops.length - 1] !== pkg) {
            hops.push(pkg);
        }
    }
    return hops;
}

/** @param {number} bytes */
function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }
    if (bytes >= 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${bytes} B`;
}

module.exports = {
    repoRoot, DEFAULT_METAFILE, FRONTEND_DIR,
    readMetafile, packageOf, isJsOrCss, outputClosure, entryOutputs, entryName, shortestChains, packageHops, formatBytes
};
