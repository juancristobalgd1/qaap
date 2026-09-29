/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { exposeModulePlugin } from '@theia/bundle-plugin';
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

browserOptions.plugins.push(exposeModulePlugin());

/**
 * Code-splitting: esbuild only splits with `format: 'esm'`, so the main window
 * entries (bundle + secondary-window) build as ES modules with shared chunks
 * (monaco/core dedupe between the two entries; hashed chunk names give
 * long-term caching — an app-only edit leaves vendor chunks byte-identical).
 * The web workers must stay classic scripts (they are constructed with
 * `new Worker(url)` without `type: 'module'`), so they build in a separate
 * IIFE context, exactly as before.
 * The login gate (qaap-login-gate.js) loads ./bundle.js with
 * `<script type="module">`; the browser resolves the chunk graph itself.
 */
const { 'editor.worker': editorWorkerEntry, 'plugin-worker': pluginWorkerEntry, ...mainEntryPoints } = browserOptions.entryPoints;

/**
 * Under `format: 'esm'`, a dynamic `import()` of a CommonJS module (all
 * TS-compiled frontend modules are CJS) yields a namespace whose `.default`
 * is the raw `module.exports` — whose own `.default` is the ContainerModule.
 * The generated loader does `container.load(containerModule.default)` and
 * crashes with "registry is not a function" on that double-default shape.
 * Patch the generated entry's loader to unwrap both shapes.
 */
const esmDiInteropPlugin = {
    name: 'qaap-esm-di-interop',
    setup(build) {
        build.onLoad({ filter: /src-gen[\\/]frontend[\\/](index|secondary-index)\.js$/ }, async args => {
            const fs = await import('node:fs/promises');
            const source = await fs.readFile(args.path, 'utf8');
            const patched = source.replaceAll(
                'container.load(containerModule.default)',
                'container.load((m => (m && typeof m.registry === \'function\') ? m : m.default)(containerModule.default))',
            );
            return { contents: patched, loader: 'js' };
        });
    },
};

/**
 * Chunk hash epoch. Chunks are served `immutable` and imported by their bare
 * content-hashed name. Until September 2026 copy-frontend-static.mjs rewrote
 * chunk imports to `chunk-X.js?qaap-build=<stamp>` AFTER esbuild hashed them,
 * so a browser may hold a year-long cached copy of a chunk whose bytes carry an
 * old stamp under a hash that still matches today's content. Folding this epoch
 * into every chunk's bytes moves all hashes once, so those poisoned cache
 * entries are never requested again. Bump it only to invalidate every chunk.
 */
const CHUNK_HASH_EPOCH = '/* qaap-chunk-epoch: 2 */';

/**
 * Stale chunk pruning. `splitting` + `chunk-[hash]` names mean every rebuild writes
 * new chunk files next to the old ones, and esbuild never cleans `outdir`, so
 * lib/frontend grew without bound (thousands of dead chunk .js/.map/.gz files,
 * gigabytes on disk, all re-stat'ed and gzipped by copy-frontend-static.mjs).
 *
 * After each successful main build, delete top-level `chunk-*` files (plus their
 * `.map` / `.gz` companions) that neither this build nor the previous one emitted,
 * according to esbuild's metafile. The previous generation is kept so a tab still
 * running the previous bundle can keep lazy-loading its chunks until it reloads.
 * Only `chunk-<HASH>.(js|css)[.map][.gz]` names are touched: entry bundles, workers,
 * and everything copy-frontend-static.mjs writes (index.html, login gate, media/,
 * legal/, manifest, service worker) are never candidates.
 */
const FRONTEND_OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'frontend');
const CHUNK_MANIFEST = path.join(FRONTEND_OUT_DIR, '..', '.qaap-frontend-chunks.json');
const PRUNABLE_CHUNK = /^chunk-[A-Z0-9]+\.(?:js|css)(?:\.map)?(?:\.gz)?$/;

function readPreviousChunkGeneration() {
    try {
        const parsed = JSON.parse(fs.readFileSync(CHUNK_MANIFEST, 'utf8'));
        return Array.isArray(parsed.chunks) ? parsed.chunks : [];
    } catch {
        return [];
    }
}

function pruneStaleFrontendChunks(metafile) {
    const current = Object.keys(metafile.outputs)
        .map(output => path.basename(output))
        .filter(name => PRUNABLE_CHUNK.test(name));
    if (!current.length || !fs.existsSync(FRONTEND_OUT_DIR)) {
        return;
    }
    const keep = new Set([...current, ...readPreviousChunkGeneration()]);
    let removed = 0;
    let failed = 0;
    for (const name of fs.readdirSync(FRONTEND_OUT_DIR)) {
        if (!PRUNABLE_CHUNK.test(name) || keep.has(name.replace(/\.gz$/, ''))) {
            continue;
        }
        try {
            fs.unlinkSync(path.join(FRONTEND_OUT_DIR, name));
            removed++;
        } catch {
            // Windows keeps served files locked; the next build retries.
            failed++;
        }
    }
    fs.writeFileSync(CHUNK_MANIFEST, JSON.stringify({ chunks: current }) + '\n', 'utf8');
    if (removed || failed) {
        console.log(`[qaap] pruned ${removed} stale frontend chunk file(s)${failed ? `, ${failed} locked (retry next build)` : ''}`);
    }
}

const pruneStaleChunksPlugin = {
    name: 'qaap-prune-stale-chunks',
    setup(build) {
        build.onEnd(result => {
            if (result.errors.length || !result.metafile) {
                return;
            }
            try {
                pruneStaleFrontendChunks(result.metafile);
            } catch (error) {
                console.warn('[qaap] stale chunk pruning skipped:', error);
            }
        });
    },
};

const mainOptions = {
    ...browserOptions,
    entryPoints: mainEntryPoints,
    format: 'esm',
    splitting: true,
    chunkNames: 'chunk-[hash]',
    metafile: true,
    banner: { ...browserOptions.banner, js: [browserOptions.banner?.js, CHUNK_HASH_EPOCH].filter(Boolean).join('\n') },
    // Interop plugin FIRST: esbuild gives the file to the first onLoad that
    // returns contents, and exposeModulePlugin also intercepts .js files.
    plugins: [esmDiInteropPlugin, ...browserOptions.plugins, pruneStaleChunksPlugin],
};
const workerOptions = {
    ...browserOptions,
    entryPoints: {
        'editor.worker': editorWorkerEntry,
        'plugin-worker': pluginWorkerEntry,
    },
};

const browserContext = await esbuild.context(mainOptions);
const workerContext = await esbuild.context(workerOptions);
const nodeContext = await esbuild.context(nodeOptions);

if (watch) {
    await Promise.all([
        browserContext.watch(),
        workerContext.watch(),
        nodeContext.watch(),
    ]);
} else {
    try {
        await browserContext.rebuild();
        await browserContext.dispose();
        await workerContext.rebuild();
        await workerContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
    } catch {
        process.exit(1);
    }
}
