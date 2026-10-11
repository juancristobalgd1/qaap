#!/usr/bin/env node
/**
 * Syncs generated frontend static files into lib/frontend (Qaap login gate + index.html)
 * and creates .gz companion files for large JS/CSS assets so the Express server can serve
 * pre-compressed content (37 MB bundle.js → ~9 MB gzipped).
 * Run after `theia build` — lib/ is not updated automatically otherwise.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as zlibConstants, createBrotliCompress, createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import resolvePackagePath from 'resolve-package-path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const qaapRoot = path.dirname(resolvePackagePath('@theia/qaap-product', root));
const requireFromBrowserScript = createRequire(import.meta.url);
const { patchIndexForFreshAssets: patchFreshAssets } = requireFromBrowserScript(
    path.join(qaapRoot, 'resources', 'qaap-frontend-asset-policy.cjs'),
);
const libFrontend = path.join(root, 'lib', 'frontend');
const srcFrontend = path.join(root, 'src-gen', 'frontend');
const srcIndex = path.join(srcFrontend, 'index.html');
const srcManifest = path.join(srcFrontend, 'manifest.webmanifest');
const srcServiceWorker = path.join(srcFrontend, 'service-worker.js');

function copyIfExists(from, to) {
    if (fs.existsSync(from)) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        return true;
    }
    return false;
}

fs.mkdirSync(libFrontend, { recursive: true });

const libIndex = path.join(libFrontend, 'index.html');
if (!copyIfExists(srcIndex, libIndex)) {
    console.warn('[qaap] src-gen/frontend/index.html missing — run: npx theia generate');
}

// The generated index loads the entry directly; earlier syncs may already have stamped or hashed it.
const BUNDLE_SCRIPT = /<script type="text\/javascript" src="\.\/bundle(?:-[A-Z0-9]+)?\.js(?:\?[^"]*)?" charset="utf-8"><\/script>/;
const GATE_SCRIPT = '<script type="text/javascript" src="./qaap-login-gate.js" charset="utf-8"></script>';
const BUILD_VERSION = Date.now().toString(36);

function readEntryAssetManifest(manifestPath) {
    try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        return undefined;
    }
}

function publishHashedEntryAssets(entryPrefix) {
    const assetManifestPath = path.join(libFrontend, `.qaap-${entryPrefix}-assets.json`);
    const sources = {
        javascript: path.join(libFrontend, `${entryPrefix}.js`),
        stylesheet: path.join(libFrontend, `${entryPrefix}.css`),
    };
    if (!Object.values(sources).every(source => fs.existsSync(source))) {
        return undefined;
    }

    const previous = readEntryAssetManifest(assetManifestPath);
    const current = {};
    for (const [kind, source] of Object.entries(sources)) {
        const bytes = fs.readFileSync(source);
        const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12).toUpperCase();
        const extension = path.extname(source);
        const filename = `${entryPrefix}-${hash}${extension}`;
        const destination = path.join(libFrontend, filename);
        if (!fs.existsSync(destination)) {
            fs.writeFileSync(destination, bytes);
        }
        current[kind] = `./${filename}`;
    }

    const keep = new Set([
        ...Object.values(current),
        ...Object.values(previous?.current ?? {}),
    ].map(value => path.basename(value)));
    const oldHashedAsset = new RegExp(`^${entryPrefix}-[A-F0-9]{12}\\.(?:js|css)(?:\\.(?:gz|br))?$`);
    for (const name of fs.readdirSync(libFrontend)) {
        if (oldHashedAsset.test(name) && !keep.has(name.replace(/\.(?:gz|br)$/, ''))) {
            fs.unlinkSync(path.join(libFrontend, name));
        }
    }

    const manifest = {
        buildVersion: BUILD_VERSION,
        current,
        previous: previous?.current,
    };
    const temporaryManifest = `${assetManifestPath}.tmp`;
    fs.writeFileSync(temporaryManifest, `${JSON.stringify(manifest)}\n`, 'utf8');
    fs.renameSync(temporaryManifest, assetManifestPath);
    return manifest;
}

function patchIndexForLoginGate(indexPath) {
    if (!fs.existsSync(indexPath) || !fs.existsSync(path.join(libFrontend, 'qaap-login-gate.js'))) {
        return;
    }
    let html = fs.readFileSync(indexPath, 'utf8');
    if (html.includes('qaap-login-gate.js')) {
        // Already gated: only make sure no direct bundle load survived an earlier sync.
        html = html.replace(BUNDLE_SCRIPT, '');
    } else if (BUNDLE_SCRIPT.test(html)) {
        html = html.replace(BUNDLE_SCRIPT, GATE_SCRIPT);
    } else {
        html = html.replace('</body>', `    ${GATE_SCRIPT}\n</body>`);
    }
    fs.writeFileSync(indexPath, html, 'utf8');
}

function patchIndexForFreshAssets(indexPath, entryAssets) {
    if (!fs.existsSync(indexPath) || !entryAssets) {
        return;
    }
    const html = patchFreshAssets(fs.readFileSync(indexPath, 'utf8'), BUILD_VERSION, entryAssets.current);
    fs.writeFileSync(indexPath, html, 'utf8');
}

/**
 * Code-split chunks are content-addressed (`chunk-<hash>.js`) and served `immutable`, so their
 * bytes must never change after esbuild hashed them and their imports must stay bare. Never
 * query-stamp chunk imports: a stamp written after hashing leaves one URL with different bytes
 * per build, a cached chunk then imports an older build's chunk URLs and the module graph is
 * evaluated twice (duplicate `@injectable`, missing bindings, "took too long to start").
 *
 * Walk the chunk graph from the ES module entry points and fail the build when it is not coherent
 * (a referenced chunk is missing, or an import carries a query), e.g. after a partial esbuild write.
 */
function verifyFrontendChunkGraph() {
    const entryPoints = ['bundle.js', 'secondary-window.js'];
    const chunkImport = /(["'])\.\/(chunk-[A-Z0-9]+\.js)(\?[^"']*)?\1/g;
    const problems = [];
    const visited = new Set();
    const queue = [];
    for (const entry of entryPoints) {
        if (fs.existsSync(path.join(libFrontend, entry))) {
            queue.push(entry);
        } else if (entry === 'bundle.js') {
            problems.push('bundle.js is missing');
        }
    }
    while (queue.length) {
        const file = queue.shift();
        if (visited.has(file)) {
            continue;
        }
        visited.add(file);
        const source = fs.readFileSync(path.join(libFrontend, file), 'utf8');
        for (const [, , chunk, query] of source.matchAll(chunkImport)) {
            if (query) {
                problems.push(`${file} imports ./${chunk}${query} (chunk imports must not carry a query)`);
            }
            if (fs.existsSync(path.join(libFrontend, chunk))) {
                queue.push(chunk);
            } else {
                problems.push(`${file} imports ./${chunk}, which does not exist`);
            }
        }
    }
    if (problems.length) {
        console.error('[qaap] lib/frontend chunk graph is incoherent — the esbuild step likely failed or wrote partially.');
        console.error('[qaap] Stop the dev server (Windows locks served files) and rerun `npm run build:browser`.');
        for (const problem of problems.slice(0, 20)) {
            console.error(`[qaap]   ${problem}`);
        }
        process.exit(1);
    }
    console.log(`[qaap] verified frontend chunk graph: ${visited.size} modules reachable from entry points`);
}

// Fail before stamping index.html: a stamped shell pointing at a broken bundle is what a
// browser would pick up on the next reload.
verifyFrontendChunkGraph();
const entryAssets = publishHashedEntryAssets('bundle');
// The gate must be in place before the index is patched to load it instead of the bundle.
copyIfExists(path.join(qaapRoot, 'resources', 'qaap-login-gate.js'), path.join(libFrontend, 'qaap-login-gate.js'));
patchIndexForLoginGate(libIndex);
// bundle.js/bundle.css are republished as content-addressed `bundle-<hash>` copies (served
// immutable, like the chunks below them). The small login gate keeps a build version so the
// HTML and the authentication handoff update together.
patchIndexForFreshAssets(libIndex, entryAssets);
// `theia start` serves the generated source index directly in development, while
// the bundled/static server serves lib/frontend/index.html. Keep both entry points
// versioned so a browser cannot bypass the fresh bundle through the dev server.
patchIndexForLoginGate(srcIndex);
patchIndexForFreshAssets(srcIndex, entryAssets);
copyIfExists(srcManifest, path.join(libFrontend, 'manifest.webmanifest'));
// Service worker must sit at the same scope as index.html so it can control the whole app.
copyIfExists(srcServiceWorker, path.join(libFrontend, 'service-worker.js'));

try {
    const legal = path.join(qaapRoot, 'resources', 'legal');
    if (fs.existsSync(legal)) {
        fs.cpSync(legal, path.join(libFrontend, 'legal'), { recursive: true });
    }
} catch {
    console.warn('[qaap] @theia/qaap-product not found — skipping qaap-login-gate.js / legal pages');
}

const media = path.join(root, 'media');
if (fs.existsSync(media)) {
    fs.cpSync(media, path.join(libFrontend, 'media'), { recursive: true });
}

// Pre-compress static assets. gzip covers everything Theia's serveGzipped handler serves; the
// content-hashed entry/chunk files also get Brotli, which QaapFrontendStaticServer negotiates
// from Accept-Encoding before Theia's gzip-only handler (~15-20% fewer bytes on a phone).
const COMPRESSIBLE_EXTS = /\.(js|css|wasm|svg|html|json)$/i;
const BROTLI_TARGET = /^(?:bundle|chunk)-[A-Z0-9]+\.(?:js|css)$/;
const PRECOMPRESS_MIN_BYTES = 1024; // skip tiny files where compression overhead isn't worth it
const PRODUCTION = process.argv.includes('--production')
    || process.argv.some((arg, i, argv) => arg === '--mode=production' || (arg === '--mode' && argv[i + 1] === 'production'))
    || process.env.NODE_ENV === 'production';
const GZIP_LEVEL = PRODUCTION ? 9 : 6;
const BROTLI_QUALITY = PRODUCTION ? 8 : 4;

async function precompressFile(filePath, encoding) {
    const stat = fs.statSync(filePath);
    if (stat.size < PRECOMPRESS_MIN_BYTES) { return; }
    const compressedPath = `${filePath}.${encoding}`;
    const srcMtime = stat.mtimeMs;
    if (fs.existsSync(compressedPath)) {
        const compressedMtime = fs.statSync(compressedPath).mtimeMs;
        if (compressedMtime >= srcMtime) { return; }
    }
    const compressor = encoding === 'br'
        ? createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } })
        : createGzip({ level: GZIP_LEVEL });
    await pipeline(
        fs.createReadStream(filePath),
        compressor,
        fs.createWriteStream(compressedPath)
    );
}

const compressionTargets = fs.readdirSync(libFrontend)
    .filter(f => COMPRESSIBLE_EXTS.test(f) && !f.startsWith('.'))
    .map(f => path.join(libFrontend, f));

const compressionResults = await Promise.allSettled(compressionTargets.flatMap(filePath => [
    BROTLI_TARGET.test(path.basename(filePath)) ? precompressFile(filePath, 'br') : Promise.resolve(),
    precompressFile(filePath, 'gz'),
]));
const failed = compressionResults.filter(r => r.status === 'rejected');
if (failed.length) {
    console.warn('[qaap] static precompression failed for some files:', failed.map(r => r.reason).join(', '));
}
const compressed = compressionTargets.filter((_, i) =>
    compressionResults[i * 2].status === 'fulfilled' || compressionResults[i * 2 + 1].status === 'fulfilled');
if (compressed.length) {
    const sizes = compressed.map(filePath => {
        const original = fs.statSync(filePath).size;
        const brotli = fs.existsSync(`${filePath}.br`) ? fs.statSync(`${filePath}.br`).size : original;
        const gzip = fs.existsSync(`${filePath}.gz`) ? fs.statSync(`${filePath}.gz`).size : original;
        return `${path.basename(filePath)}: ${(original / 1e6).toFixed(1)} MB → ${(brotli / 1e6).toFixed(1)} MB br / ${(gzip / 1e6).toFixed(1)} MB gzip`;
    });
    console.log('[qaap] precompressed:', sizes.join(', '));
}

// Stale code-split chunks are pruned by esbuild.mjs (qaap-prune-stale-chunks) right after the
// main build, from esbuild's metafile: it keeps this build's chunks plus the previous build's, so
// a tab still on the previous bundle can keep lazy-loading its chunks. Never prune here by
// timestamp: the bundle and its chunks can be written by different build steps.

console.log('[qaap] synced frontend static files → lib/frontend/');
