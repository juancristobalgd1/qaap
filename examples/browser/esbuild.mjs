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
 * The same plugin also parallelizes the module fetches. The generated entry does
 * `await load(container, import('...'))` once per frontend module (~100), and
 * with splitting each `import()` is a chunk request issued only after the
 * previous module loaded: one serial round trip per module on a cold cache.
 * Each run of consecutive such lines becomes one array of `import()` promises
 * started up front, followed by `await load(container, <promise N>)` in the
 * original order, so `container.load` (DI binding) order is unchanged. Chunk
 * bodies may now evaluate in arrival order; frontend module bodies only define
 * classes and a ContainerModule, and their dependencies resolve through
 * `require`. The preload block and the main block remain separate runs: the
 * main imports must not start before the preloader has loaded the localization,
 * because module-level `nls.localize` calls read it at evaluation time.
 */
const SEQUENTIAL_MODULE_LOADS = /^([ \t]*)await load\(container, import\(('[^']+'|"[^"]+")\)\);[ \t]*\r?\n(?:[ \t]*await load\(container, import\((?:'[^']+'|"[^"]+")\)\);[ \t]*\r?\n)+/gm;

function parallelizeModuleLoads(source) {
    let run = 0;
    return source.replace(SEQUENTIAL_MODULE_LOADS, block => {
        const indent = block.match(/^[ \t]*/)[0];
        const eol = block.includes('\r\n') ? '\r\n' : '\n';
        const specifiers = [...block.matchAll(/import\(('[^']+'|"[^"]+")\)/g)].map(match => match[1]);
        const name = `qaapFrontendModules${run++}`;
        return [
            `${indent}const ${name} = [`,
            ...specifiers.map(specifier => `${indent}    import(${specifier}),`),
            `${indent}];`,
            // Rejections surface through the ordered awaits below; keep promises that
            // are not awaited yet (a failure aborts the loop) from reporting as unhandled.
            `${indent}${name}.forEach(modulePromise => modulePromise.catch(() => undefined));`,
            ...specifiers.map((_, index) => `${indent}await load(container, ${name}[${index}]);`),
            '',
        ].join(eol);
    });
}

const esmDiInteropPlugin = {
    name: 'qaap-esm-di-interop',
    setup(build) {
        build.onLoad({ filter: /src-gen[\\/]frontend[\\/](index|secondary-index)\.js$/ }, async args => {
            const fs = await import('node:fs/promises');
            const source = await fs.readFile(args.path, 'utf8');
            const patched = parallelizeModuleLoads(source.replaceAll(
                'container.load(containerModule.default)',
                'container.load((m => (m && typeof m.registry === \'function\') ? m : m.default)(containerModule.default))',
            ));
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
    plugins: [esmDiInteropPlugin, lazyCssPlugin, ...browserOptions.plugins, pruneStaleChunksPlugin],
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
