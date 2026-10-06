/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { exposeModulePlugin } from '@theia/bundle-plugin';
import esbuild from 'esbuild';
import { createHash } from 'node:crypto';
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
 *
 * The generated entry keeps its sequential `await load(container, import(...))`
 * lines: each frontend module chunk is evaluated only after the previous module
 * loaded, exactly as the generator intends. #146 started every `import()` up
 * front instead, so chunk bodies evaluated in network/cache arrival order; since
 * then the mobile E2E suite intermittently never finished starting ("took too
 * long to start"), mostly after a reload, when every chunk arrives from cache at
 * once. The fetch
 * parallelism now comes from `<link rel="modulepreload">` hints for the entry's
 * chunks (modulePreloadPlugin below): preloaded modules are fetched and parsed
 * concurrently but only evaluated when the ordered `import()` reaches them.
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
const PRUNABLE_CHUNK = /^chunk-[A-Z0-9]+\.(?:js|css)(?:\.map)?(?:\.(?:gz|br))?$/;

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
        if (!PRUNABLE_CHUNK.test(name) || keep.has(name.replace(/\.(?:gz|br)$/, ''))) {
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

/**
 * Truly-lazy stylesheets. A CSS import — static or `import()` — is merged into
 * the entry's bundle.css by esbuild whatever its import kind (TS compiles
 * `import()` to `require()` anyway), so a "lazy" CSS import never saved a
 * byte. A specifier ending in `?qaap-lazy` opts out: the stylesheet is bundled
 * on its own (its `@import`s and `url()` assets included) into a
 * content-addressed `chunk-<HASH>.css` next to the chunks — so the backend's
 * immutable-chunk caching and copy-frontend-static's gzip step apply as-is —
 * and the import's default export is that file's absolute URL. Frontend code
 * attaches it with `<link rel="stylesheet">` when its surface first opens
 * (see `QaapLazyStylesheets` in @theia/qaap-product-theme).
 */
const LAZY_CSS_SUFFIX = /\?qaap-lazy$/;
const LAZY_CSS_NAMESPACE = 'qaap-lazy-css';
/** Source stylesheet path → emitted file name; survives incremental (watch) rebuilds. */
const lazyStylesheetOutputs = new Map();

function lazyCssHash(contents) {
    // Same alphabet as esbuild's `[hash]` so the file matches PRUNABLE_CHUNK and the
    // backend's HASHED_CHUNK_FILE_PATTERN (immutable caching).
    return createHash('sha256').update(contents).digest('hex').slice(0, 10).toUpperCase();
}

const lazyCssPlugin = {
    name: 'qaap-lazy-css',
    setup(build) {
        build.onResolve({ filter: LAZY_CSS_SUFFIX }, async args => {
            const resolved = await build.resolve(args.path.replace(LAZY_CSS_SUFFIX, ''), {
                kind: args.kind,
                resolveDir: args.resolveDir,
                importer: args.importer,
            });
            if (resolved.errors.length) {
                return { errors: resolved.errors };
            }
            return { path: resolved.path, namespace: LAZY_CSS_NAMESPACE };
        });
        build.onLoad({ filter: /.*/, namespace: LAZY_CSS_NAMESPACE }, async args => {
            const result = await esbuild.build({
                entryPoints: [args.path],
                bundle: true,
                write: false,
                metafile: true,
                outdir: FRONTEND_OUT_DIR,
                loader: browserOptions.loader,
                minify: browserOptions.minify,
                logLevel: 'silent',
            });
            const css = result.outputFiles.find(file => file.path.endsWith('.css'));
            const extra = result.outputFiles.filter(file => file !== css);
            if (extra.length) {
                // Only the stylesheet is written: every asset must be inlined (all asset loaders are `dataurl`).
                return { errors: [{ text: `lazy stylesheet ${args.path} emits separate assets (${extra.map(file => path.basename(file.path)).join(', ')}), which would be lost` }] };
            }
            const fileName = `chunk-${lazyCssHash(css.contents)}.css`;
            const target = path.join(FRONTEND_OUT_DIR, fileName);
            if (!fs.existsSync(target)) {
                fs.mkdirSync(FRONTEND_OUT_DIR, { recursive: true });
                fs.writeFileSync(target, css.contents);
            }
            lazyStylesheetOutputs.set(args.path, fileName);
            return {
                contents: `export default new URL(${JSON.stringify(`./${fileName}`)}, import.meta.url).href;\n`,
                loader: 'js',
                watchFiles: Object.keys(result.metafile.inputs).map(input => path.resolve(input)),
            };
        });
    },
};

const pruneStaleChunksPlugin = {
    name: 'qaap-prune-stale-chunks',
    setup(build) {
        build.onEnd(result => {
            if (result.errors.length || !result.metafile) {
                return;
            }
            try {
                const lazyOutputs = Object.fromEntries([...lazyStylesheetOutputs.values()].map(name => [name, {}]));
                pruneStaleFrontendChunks({ ...result.metafile, outputs: { ...result.metafile.outputs, ...lazyOutputs } });
            } catch (error) {
                console.warn('[qaap] stale chunk pruning skipped:', error);
            }
        });
    },
};

/**
 * Fetch parallelism for the sequential frontend module loads (see esbuild-DI interop above).
 * After each build, append to the `bundle` entry a snippet that adds a
 * `<link rel="modulepreload">` for every chunk the entry imports dynamically (its frontend
 * modules), taken from the metafile. A preloaded chunk is fetched and parsed concurrently but
 * evaluated only when the ordered `import()` reaches it, so DI and evaluation order stay exactly
 * as generated. The snippet runs synchronously while the entry's async startup is parked at its
 * first `await` (the preloader), i.e. before any main module is imported. It lives in bundle.js,
 * not index.html, because `theia start` regenerates index.html on every start. The snippet goes
 * before the `sourceMappingURL` comment so every mapped line keeps its position.
 */
const MODULE_PRELOAD_ENTRY = 'bundle.js';

function appendModulePreloads(metafile) {
    const [entryOutput, entry] = Object.entries(metafile.outputs)
        .find(([output]) => path.basename(output) === MODULE_PRELOAD_ENTRY) ?? [];
    if (!entry) {
        return;
    }
    const chunks = [...new Set(entry.imports
        .filter(imported => imported.kind === 'dynamic-import' && !imported.external)
        .map(imported => path.basename(imported.path))
        .filter(name => PRUNABLE_CHUNK.test(name) && name.endsWith('.js')))];
    if (!chunks.length) {
        return;
    }
    const file = path.resolve(entryOutput);
    const source = fs.readFileSync(file, 'utf8');
    const snippet = [
        '// qaap: modulepreload the frontend module chunks (fetched in parallel, evaluated in order)',
        `for (const qaapPreloadChunk of ${JSON.stringify(chunks)}) {`,
        '  const qaapPreloadLink = document.createElement("link");',
        '  qaapPreloadLink.rel = "modulepreload";',
        '  qaapPreloadLink.href = new URL("./" + qaapPreloadChunk, import.meta.url).href;',
        '  document.head.appendChild(qaapPreloadLink);',
        '}',
        '',
    ].join('\n');
    const mapComment = source.lastIndexOf('//# sourceMappingURL=');
    const patched = mapComment === -1
        ? `${source}\n${snippet}`
        : `${source.slice(0, mapComment)}${snippet}${source.slice(mapComment)}`;
    fs.writeFileSync(file, patched);
}

const modulePreloadPlugin = {
    name: 'qaap-module-preload',
    setup(build) {
        build.onEnd(result => {
            if (result.errors.length || !result.metafile) {
                return;
            }
            try {
                appendModulePreloads(result.metafile);
            } catch (error) {
                console.warn('[qaap] modulepreload hints skipped:', error);
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
    plugins: [esmDiInteropPlugin, lazyCssPlugin, ...browserOptions.plugins, modulePreloadPlugin, pruneStaleChunksPlugin],
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
