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

function patchFrontendChunkImports() {
    for (const file of fs.readdirSync(libFrontend)) {
        if (!file.endsWith('.js') || file === 'qaap-login-gate.js') {
            continue;
        }
        const filePath = path.join(libFrontend, file);
        const source = fs.readFileSync(filePath, 'utf8');
        const patched = source.replace(
            /(["'])\.\/(chunk-[A-Z0-9]+\.js)(?:\?[^"']*)?\1/g,
            `$1./$2?qaap-build=${BUILD_VERSION}$1`,
        );
        if (patched !== source) {
            fs.writeFileSync(filePath, patched, 'utf8');
        }
    }
}

patchIndexForLoginGate(libIndex);
// The development browser can retain generated assets across reloads. Give each
// CSS, JS bundle, and code-split chunk URL a build version so the new visual
// contract is fetched as one coherent build.
patchIndexForFreshAssets(libIndex);
// `theia start` serves the generated source index directly in development, while
// the bundled/static server serves lib/frontend/index.html. Keep both entry points
// versioned so a browser cannot bypass the fresh bundle through the dev server.
patchIndexForLoginGate(srcIndex);
patchIndexForFreshAssets(srcIndex);
patchFrontendChunkImports();
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
        createGzip({ level: 9 }),
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

// Keep generated chunks recoverable between browser rebuilds. A timestamp-based prune is
// unsafe here: the bundle and its code-split chunks can be written by different build steps,
// and deleting a chunk before the browser has fetched it leaves the app at the startup error
// screen. Cache-busting makes old files harmless, while retaining them avoids breaking a
// bundle whose imports were written just before a concurrent copy step completed.
console.log('[qaap] retained generated chunks for safe browser reloads');

console.log('[qaap] synced frontend static files → lib/frontend/');
