#!/usr/bin/env node
/**
 * Syncs generated frontend static files into lib/frontend (Qaap login gate + index.html)
 * and creates .gz companion files for large JS/CSS assets so the Express server can serve
 * pre-compressed content (37 MB bundle.js → ~9 MB gzipped).
 * Run after `theia build` — lib/ is not updated automatically otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
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
const BUILD_VERSION = Date.now().toString(36);

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

function patchIndexForFreshAssets(indexPath) {
    const bundleCss = path.join(libFrontend, 'bundle.css');
    const bundleJs = path.join(libFrontend, 'bundle.js');
    if (!fs.existsSync(indexPath) || !fs.existsSync(bundleCss) || !fs.existsSync(bundleJs)) {
        return;
    }
    const html = fs.readFileSync(indexPath, 'utf8').replace(
        /\.\/bundle\.css(?:\?[^"'\s>]*)?/g,
        `./bundle.css?qaap-build=${BUILD_VERSION}`,
    ).replace(
        /\.\/bundle\.js(?:\?[^"'\s>]*)?/g,
        `./bundle.js?qaap-build=${BUILD_VERSION}`,
    ).replace(
        /\.\/qaap-login-gate\.js(?:\?[^"'\s>]*)?/g,
        `./qaap-login-gate.js?qaap-build=${BUILD_VERSION}`,
    );
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
patchIndexForLoginGate(libIndex);
// The development browser can retain generated assets across reloads. Give the
// non-hashed entry points (CSS, JS bundle, login gate) a build version so the new
// visual contract is fetched as one coherent build. Chunks below the bundle are
// content-hashed and need no stamp (see verifyFrontendChunkGraph).
patchIndexForFreshAssets(libIndex);
// `theia start` serves the generated source index directly in development, while
// the bundled/static server serves lib/frontend/index.html. Keep both entry points
// versioned so a browser cannot bypass the fresh bundle through the dev server.
patchIndexForLoginGate(srcIndex);
patchIndexForFreshAssets(srcIndex);
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

const media = path.join(root, 'media');
if (fs.existsSync(media)) {
    fs.cpSync(media, path.join(libFrontend, 'media'), { recursive: true });
}

// Pre-compress large assets so the Express server (serveGzipped) can serve .gz directly.
// This converts the 37 MB bundle.js into ~9 MB — a critical mobile performance win.
const GZIP_EXTS = /\.(js|css|wasm|svg|html|json)$/i;
const GZIP_MIN_BYTES = 1024; // skip tiny files where gzip overhead isn't worth it
// Level 9 costs several times the CPU of level 6 for ~1-2% smaller output: only worth it
// for production bundles. Development builds (`npm run bundle`) use level 6. serveGzipped
// falls back to the uncompressed file when no .gz companion exists, so either is safe.
const PRODUCTION = process.argv.includes('--production')
    || process.argv.some((arg, i, argv) => arg === '--mode=production' || (arg === '--mode' && argv[i + 1] === 'production'))
    || process.env.NODE_ENV === 'production';
const GZIP_LEVEL = PRODUCTION ? 9 : 6;

async function gzipFile(filePath) {
    const stat = fs.statSync(filePath);
    if (stat.size < GZIP_MIN_BYTES) { return; }
    const gzPath = filePath + '.gz';
    const srcMtime = stat.mtimeMs;
    if (fs.existsSync(gzPath)) {
        const gzMtime = fs.statSync(gzPath).mtimeMs;
        if (gzMtime >= srcMtime) { return; } // already up-to-date
    }
    await pipeline(
        fs.createReadStream(filePath),
        createGzip({ level: GZIP_LEVEL }),
        fs.createWriteStream(gzPath)
    );
}

const gzipTargets = fs.readdirSync(libFrontend)
    .filter(f => GZIP_EXTS.test(f) && !f.endsWith('.gz'))
    .map(f => path.join(libFrontend, f));

const gzipResults = await Promise.allSettled(gzipTargets.map(gzipFile));
const failed = gzipResults.filter(r => r.status === 'rejected');
if (failed.length) {
    console.warn('[qaap] gzip failed for some files:', failed.map(r => r.reason).join(', '));
}

const compressed = gzipTargets.filter((_, i) => gzipResults[i].status === 'fulfilled');
if (compressed.length) {
    const sizes = compressed.map(f => {
        const orig = fs.statSync(f).size;
        const gz = fs.existsSync(f + '.gz') ? fs.statSync(f + '.gz').size : orig;
        return `${path.basename(f)}: ${(orig / 1e6).toFixed(1)} MB → ${(gz / 1e6).toFixed(1)} MB`;
    });
    console.log('[qaap] gzipped:', sizes.join(', '));
}

// Stale code-split chunks are pruned by esbuild.mjs (qaap-prune-stale-chunks) right after the
// main build, from esbuild's metafile: it keeps this build's chunks plus the previous build's, so
// a tab still on the previous bundle can keep lazy-loading its chunks. Never prune here by
// timestamp: the bundle and its chunks can be written by different build steps.

console.log('[qaap] synced frontend static files → lib/frontend/');
