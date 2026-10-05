#!/usr/bin/env node
/**
 * Syncs generated frontend static files into lib/frontend (Qaap login gate + index.html)
 * and creates .gz and .br companion files for large JS/CSS assets so the Express server can serve
 * pre-compressed content without spending CPU compressing each response.
 * Run after `theia build` — lib/ is not updated automatically otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { constants as zlibConstants, createBrotliCompress, createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import resolvePackagePath from 'resolve-package-path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
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

const BUNDLE_SCRIPT = '<script type="text/javascript" src="./bundle.js" charset="utf-8"></script>';
const GATE_SCRIPT = '<script type="text/javascript" src="./qaap-login-gate.js" charset="utf-8"></script>';

function patchIndexForLoginGate(indexPath) {
    if (!fs.existsSync(indexPath) || !fs.existsSync(path.join(libFrontend, 'qaap-login-gate.js'))) {
        return;
    }
    let html = fs.readFileSync(indexPath, 'utf8');
    if (html.includes('qaap-login-gate.js')) {
        return;
    }
    if (html.includes(BUNDLE_SCRIPT)) {
        html = html.replace(BUNDLE_SCRIPT, GATE_SCRIPT);
    } else {
        html = html.replace('</body>', `    ${GATE_SCRIPT}\n</body>`);
    }
    fs.writeFileSync(indexPath, html, 'utf8');
}

function computeFrontendBuildHash() {
    const assets = ['bundle.js', 'bundle.mobile.js', 'bundle.css', 'qaap-login-gate.js'];
    const hash = createHash('sha256');
    for (const asset of assets) {
        const assetPath = path.join(libFrontend, asset);
        if (!fs.existsSync(assetPath)) {
            if (asset === 'qaap-login-gate.js') {
                continue;
            }
            throw new Error(`[qaap] Cannot fingerprint frontend assets: ${asset} is missing`);
        }
        hash.update(asset);
        hash.update('\0');
        hash.update(fs.readFileSync(assetPath));
        hash.update('\0');
    }
    return hash.digest('hex');
}

/** Same rule as QAAP_MOBILE_DEVICE_MEDIA_QUERY (qaap-mobile-device.ts) and qaap-login-gate.js. */
const MOBILE_DEVICE_MEDIA_QUERY = '(max-width: 767px), (pointer: coarse)';
const DESKTOP_DEVICE_MEDIA_QUERY = '(min-width: 768px) and (pointer: fine), (min-width: 768px) and (pointer: none)';
const ENTRY_MODULE_PRELOADS = [
    `<link rel="modulepreload" href="./bundle.js" media="${DESKTOP_DEVICE_MEDIA_QUERY}">`,
    `<link rel="modulepreload" href="./bundle.mobile.js" media="${MOBILE_DEVICE_MEDIA_QUERY}">`,
].join('\n');

function patchIndexForFreshAssets(indexPath, buildHash) {
    const bundleCss = path.join(libFrontend, 'bundle.css');
    const bundleJs = path.join(libFrontend, 'bundle.js');
    if (!fs.existsSync(indexPath) || !fs.existsSync(bundleCss) || !fs.existsSync(bundleJs)) {
        return;
    }
    let html = fs.readFileSync(indexPath, 'utf8');
    // qaap-login-gate.js injects bundle.js late (after its own checks); start fetching the
    // ES module entry while the page parses. The href gets the same stamp below that the
    // gate derives from bundle.css, so the preloaded module is the one it imports. Phones
    // get bundle.mobile.js (see the gate): each hint only applies to its own devices.
    // Rewrite the hints on every build: src-gen/frontend/index.html survives rebuilds.
    html = html.replace(/<link rel="modulepreload" href="\.\/bundle(?:\.mobile)?\.js[^>]*>\n?/g, '');
    html = html.replace('</head>', `${ENTRY_MODULE_PRELOADS}\n</head>`);
    html = html.replace(
        /\.\/bundle\.css(?:\?[^"'\s>]*)?/g,
        `./bundle.css?qaap-build=${buildHash}`,
    ).replace(
        /\.\/bundle\.js(?:\?[^"'\s>]*)?/g,
        `./bundle.js?qaap-build=${buildHash}`,
    ).replace(
        /\.\/bundle\.mobile\.js(?:\?[^"'\s>]*)?/g,
        `./bundle.mobile.js?qaap-build=${buildHash}`,
    ).replace(
        /\.\/qaap-login-gate\.js(?:\?[^"'\s>]*)?/g,
        `./qaap-login-gate.js?qaap-build=${buildHash}`,
    );
    fs.writeFileSync(indexPath, html, 'utf8');
}

const ENTRY_BUILD_MARKER = /\bQAAP_ENTRY_BUILD(\s*=\s*)"[^"]*"/g;

function stampEntryBuild(filePath, buildHash) {
    if (!fs.existsSync(filePath)) {
        return;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    const stamped = source.replace(ENTRY_BUILD_MARKER, `QAAP_ENTRY_BUILD$1"${buildHash}"`);
    if (stamped !== source) {
        fs.writeFileSync(filePath, stamped, 'utf8');
    }
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
    const entryPoints = ['bundle.js', 'bundle.mobile.js', 'secondary-window.js'];
    const chunkImport = /(["'])\.\/(chunk-[A-Z0-9]+\.js)(\?[^"']*)?\1/g;
    const problems = [];
    const visited = new Set();
    const queue = [];
    for (const entry of entryPoints) {
        if (fs.existsSync(path.join(libFrontend, entry))) {
            queue.push(entry);
        } else if (entry !== 'secondary-window.js') {
            problems.push(`${entry} is missing`);
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
copyIfExists(srcManifest, path.join(libFrontend, 'manifest.webmanifest'));
// Service worker must sit at the same scope as index.html so it can control the whole app.
copyIfExists(srcServiceWorker, path.join(libFrontend, 'service-worker.js'));

try {
    const qaapRoot = path.dirname(resolvePackagePath('@theia/qaap-product', root));
    const gate = path.join(qaapRoot, 'resources', 'qaap-login-gate.js');
    copyIfExists(gate, path.join(libFrontend, 'qaap-login-gate.js'));
    const legal = path.join(qaapRoot, 'resources', 'legal');
    if (fs.existsSync(legal)) {
        fs.cpSync(legal, path.join(libFrontend, 'legal'), { recursive: true });
    }
} catch {
    console.warn('[qaap] @theia/qaap-product not found — skipping qaap-login-gate.js / legal pages');
}

patchIndexForLoginGate(libIndex);
// Fingerprint all entry assets as one build so CSS, the login gate, and the JS
// entry point are cached together. The index stays revalidated, and esbuild
// chunks remain independently content-addressed.
const BUILD_HASH = computeFrontendBuildHash();
patchIndexForFreshAssets(libIndex, BUILD_HASH);
// `theia start` serves the generated source index directly in development, while
// the bundled/static server serves lib/frontend/index.html. Keep both entry points
// on the same fingerprint so either server gets a coherent bundle graph.
patchIndexForLoginGate(srcIndex);
patchIndexForFreshAssets(srcIndex, BUILD_HASH);
// The service worker keys its caches by build and tells pages which build it serves; both the
// worker and its registration script in index.html are generated before bundling, so they carry
// an empty marker until here. Rewrite (not just fill) it: src-gen survives rebuilds.
for (const file of [libIndex, srcIndex, srcServiceWorker, path.join(libFrontend, 'service-worker.js')]) {
    stampEntryBuild(file, BUILD_HASH);
}

const media = path.join(root, 'media');
if (fs.existsSync(media)) {
    fs.cpSync(media, path.join(libFrontend, 'media'), { recursive: true });
}

// Pre-compress large assets so the backend serves them without compressing per response:
// `.br` (QaapFrontendStaticServer, when the client accepts brotli) and `.gz` (core serveGzipped).
const GZIP_EXTS = /\.(js|css|wasm|svg|html|json)$/i;
// Stylesheet fonts emitted as `chunk-<hash>.ttf|eot` (esbuild.mjs) are uncompressed sfnt: brotli only,
// since core's serveGzipped never looks up their `.gz`. woff/woff2 are compressed already.
const BROTLI_ONLY_EXTS = /\.(ttf|eot)$/i;
const GZIP_MIN_BYTES = 1024; // skip tiny files where gzip overhead isn't worth it
const REQUIRED_GZIP_ASSETS = ['bundle.js', 'bundle.mobile.js', 'bundle.css'];
// Level 9 costs several times the CPU of level 6 for ~1-2% smaller output: only worth it
// for production bundles. Development builds (`npm run bundle`) use level 6. serveGzipped
// falls back to the uncompressed file when no .gz companion exists, so either is safe.
const PRODUCTION = process.argv.includes('--production')
    || process.argv.some((arg, i, argv) => arg === '--mode=production' || (arg === '--mode' && argv[i + 1] === 'production'))
    || process.env.NODE_ENV === 'production';
const GZIP_LEVEL = PRODUCTION ? 9 : 6;
// Brotli 11 is ~15-20% smaller than gzip 9 on these bundles but slow to compress: production
// only. Quality 5 still beats gzip 6 at a similar cost. Missing .br falls back to .gz.
const BROTLI_QUALITY = PRODUCTION ? 11 : 5;

function createBrotli(filePath, size) {
    return createBrotliCompress({
        params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
            [zlibConstants.BROTLI_PARAM_SIZE_HINT]: size,
            [zlibConstants.BROTLI_PARAM_MODE]: BROTLI_ONLY_EXTS.test(filePath) ? zlibConstants.BROTLI_MODE_FONT
                : /\.wasm$/i.test(filePath) ? zlibConstants.BROTLI_MODE_GENERIC : zlibConstants.BROTLI_MODE_TEXT,
        },
    });
}

async function precompressFile(filePath, suffix, createCompressor) {
    const stat = fs.statSync(filePath);
    if (stat.size < GZIP_MIN_BYTES) { return; }
    const compressedPath = filePath + suffix;
    const srcMtime = stat.mtimeMs;
    if (fs.existsSync(compressedPath)) {
        const compressedMtime = fs.statSync(compressedPath).mtimeMs;
        if (compressedMtime >= srcMtime) { return; } // already up-to-date
    }
    const temporaryPath = `${compressedPath}.${process.pid}.tmp`;
    try {
        await pipeline(
            fs.createReadStream(filePath),
            createCompressor(filePath, stat.size),
            fs.createWriteStream(temporaryPath)
        );
        fs.renameSync(temporaryPath, compressedPath);
    } catch (error) {
        if (fs.existsSync(temporaryPath)) {
            fs.unlinkSync(temporaryPath);
        }
        throw error;
    }
}

const gzipFile = filePath => precompressFile(filePath, '.gz', () => createGzip({ level: GZIP_LEVEL }));
const brotliFile = filePath => precompressFile(filePath, '.br', createBrotli);

const gzipTargets = fs.readdirSync(libFrontend)
    .filter(f => GZIP_EXTS.test(f))
    .map(f => path.join(libFrontend, f));

const brotliTargets = [
    ...gzipTargets,
    ...fs.readdirSync(libFrontend).filter(f => BROTLI_ONLY_EXTS.test(f)).map(f => path.join(libFrontend, f)),
];

const [gzipResults, brotliResults] = await Promise.all([
    Promise.allSettled(gzipTargets.map(gzipFile)),
    Promise.allSettled(brotliTargets.map(brotliFile)),
]);
const failed = [...gzipResults, ...brotliResults].filter(r => r.status === 'rejected');
if (failed.length) {
    console.warn('[qaap] pre-compression failed for some files:', failed.map(r => r.reason).join(', '));
}

const missingRequiredGzip = REQUIRED_GZIP_ASSETS.filter(asset => {
    const sourcePath = path.join(libFrontend, asset);
    if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).size < GZIP_MIN_BYTES) {
        return false;
    }
    return ['.gz', '.br'].some(suffix => {
        const compressedPath = `${sourcePath}${suffix}`;
        return !fs.existsSync(compressedPath)
            || fs.statSync(compressedPath).size === 0
            || fs.statSync(compressedPath).mtimeMs < fs.statSync(sourcePath).mtimeMs;
    });
});
if (missingRequiredGzip.length) {
    throw new Error(`[qaap] Required pre-compressed frontend assets are missing or stale: ${missingRequiredGzip.join(', ')}`);
}

const compressed = gzipTargets.filter((_, i) => gzipResults[i].status === 'fulfilled');
if (compressed.length) {
    const sizes = compressed.map(f => {
        const orig = fs.statSync(f).size;
        const gz = fs.existsSync(f + '.gz') ? fs.statSync(f + '.gz').size : orig;
        const br = fs.existsSync(f + '.br') ? fs.statSync(f + '.br').size : gz;
        return `${path.basename(f)}: ${(orig / 1e6).toFixed(1)} MB → gz ${(gz / 1e6).toFixed(1)} MB, br ${(br / 1e6).toFixed(1)} MB`;
    });
    console.log('[qaap] pre-compressed:', sizes.join(', '));
}

/**
 * Print the JS each entry costs a cold load: its static-import closure (fetched before the app can
 * run) and what stays behind dynamic `import()`. Raw and brotli bytes, so the phone entry
 * (bundle.mobile.js) can be compared with the desktop entry (bundle.js) from any CI build log.
 */
function reportEntryWeights() {
    const staticImport = /(?:\bfrom|\bimport)\s*(["'])\.\/(chunk-[A-Z0-9]+\.js)\1/g;
    const dynamicImport = /\bimport\(\s*(["'])\.\/(chunk-[A-Z0-9]+\.js)\1\s*\)/g;
    const edges = new Map();
    const importsOf = file => {
        let found = edges.get(file);
        if (!found) {
            const source = fs.readFileSync(path.join(libFrontend, file), 'utf8');
            found = {
                eager: [...source.matchAll(staticImport)].map(match => match[2]),
                lazy: [...source.matchAll(dynamicImport)].map(match => match[2])
            };
            edges.set(file, found);
        }
        return found;
    };
    const closure = (entry, followLazy) => {
        const seen = new Set();
        const queue = [entry];
        while (queue.length) {
            const file = queue.shift();
            if (seen.has(file) || !fs.existsSync(path.join(libFrontend, file))) {
                continue;
            }
            seen.add(file);
            const { eager, lazy } = importsOf(file);
            queue.push(...eager, ...(followLazy ? lazy : []));
        }
        return seen;
    };
    const weigh = files => {
        let raw = 0;
        let br = 0;
        for (const file of files) {
            const filePath = path.join(libFrontend, file);
            const size = fs.statSync(filePath).size;
            raw += size;
            br += fs.existsSync(filePath + '.br') ? fs.statSync(filePath + '.br').size : size;
        }
        return `${files.size} files, ${(raw / 1e6).toFixed(2)} MB raw, ${(br / 1e6).toFixed(2)} MB br`;
    };
    for (const entry of ['bundle.js', 'bundle.mobile.js']) {
        if (fs.existsSync(path.join(libFrontend, entry))) {
            const eager = closure(entry, false);
            const lazy = new Set([...closure(entry, true)].filter(file => !eager.has(file)));
            console.log(`[qaap] entry weight ${entry}: eager ${weigh(eager)}; lazy ${weigh(lazy)}`);
        }
    }
}

reportEntryWeights();

// Stale code-split chunks are pruned by esbuild.mjs (qaap-prune-stale-chunks) right after the
// main build, from esbuild's metafile: it keeps this build's chunks plus the previous build's, so
// a tab still on the previous bundle can keep lazy-loading its chunks. Never prune here by
// timestamp: the bundle and its chunks can be written by different build steps.

console.log('[qaap] synced frontend static files → lib/frontend/');
