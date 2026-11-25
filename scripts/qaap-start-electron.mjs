#!/usr/bin/env node
/**
 * Development entry point for the Electron app (`examples/electron`, script `start`).
 * Mirrors `qaap-start-browser.mjs`: a local desktop run skips the sign-in gate by default
 * (QAAP_SKIP_AUTH=1, the same as `npm run start:browser`). The Electron backend listens on
 * loopback only and accepts requests from the app window's token cookie, so no GitHub
 * OAuth callback (which would need a fixed port) is involved. Arguments are passed to `theia start`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const isWindows = process.platform === 'win32';

/**
 * Loads `KEY=VALUE` lines from `examples/electron/.env` (the working directory) without any dependency.
 * Comments and blank lines are skipped, and a variable already set in the environment wins. Values are
 * never printed.
 */
function loadElectronDotEnv(file, env) {
    if (!existsSync(file)) {
        return env;
    }
    for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const separator = line.indexOf('=');
        if (separator <= 0) {
            continue;
        }
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (/^(['"]).*\1$/.test(value)) {
            value = value.slice(1, -1);
        }
        if (env[key] === undefined) {
            env[key] = value;
        }
    }
    return env;
}

const env = loadElectronDotEnv(path.resolve(process.cwd(), '.env'), { ...process.env });
env.QAAP_SKIP_AUTH = env.QAAP_SKIP_AUTH || '1';
// The desktop runtime serves the GitHub device-flow routes and lets a GitHub session import repositories.
env.QAAP_DESKTOP = '1';
// The web OAuth public URL (`.env` shares it with `start:browser`) names a fixed origin such as
// http://localhost:3000. The desktop backend listens on a loopback port chosen at launch and signs in
// with the device flow, so that origin is another server: every reader of the variable (preview URLs,
// isolated preview hosts and their frame-ancestors, CSP) would point the app at it. Derive the
// origin from the window's own requests instead. Set it empty rather than deleting it: `theia start`
// re-reads `.env` (applyLocalEnvFile) and only fills variables that are still undefined; every reader
// trims the value and treats an empty one as unset.
env.QAAP_OAUTH_PUBLIC_URL = '';

/**
 * macOS titles the menu bar's application menu (and the Dock / Cmd-Tab entry) with the running bundle's
 * `CFBundleName`, which `app.setName` cannot change. A dev run uses the stock `Electron.app` from
 * node_modules, so the menu read "Electron". Rename that bundle to the product name once; its ad-hoc
 * signature does not seal Info.plist, so the binary still launches. A packaged build sets this itself.
 */
function brandDevElectronBundle(productName) {
    if (process.platform !== 'darwin') {
        return;
    }
    try {
        const binary = createRequire(path.resolve(process.cwd(), 'package.json'))('electron');
        const plist = path.resolve(path.dirname(binary), '..', 'Info.plist');
        if (typeof binary !== 'string' || !existsSync(plist)) {
            return;
        }
        for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
            const current = execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, plist], { encoding: 'utf8' }).trim();
            if (current !== productName) {
                execFileSync('/usr/bin/plutil', ['-replace', key, '-string', productName, plist]);
            }
        }
    } catch (error) {
        console.warn(`[qaap] Could not rename the dev Electron bundle: ${error instanceof Error ? error.message : error}`);
    }
}

brandDevElectronBundle('Qaap');

/**
 * The Dock tooltip and Finder read the bundle's folder name, so a run from `Electron.app` still says
 * "Electron" even with the renamed Info.plist (a symlink named `Electron.app` is not enough either:
 * Launch Services keeps the path it was launched from). Keep an APFS clone of the stock bundle named after
 * the product next to it (`node_modules/electron/dist/Qaap.app`, refreshed when the Electron version
 * changes) and point the `electron` package's `path.txt` at it, so `electron/cli.js` launches the clone by
 * its real path. The clone gets its own bundle id so Launch Services does not reuse the stock entry's name.
 * A reinstall of `electron` rewrites `path.txt` and the next start points it again. Any failure keeps the
 * stock bundle.
 */
function useProductNamedDevBundle(productName) {
    if (process.platform !== 'darwin') {
        return;
    }
    try {
        const electronRoot = path.dirname(createRequire(path.resolve(process.cwd(), 'package.json')).resolve('electron/package.json'));
        const distDir = path.join(electronRoot, 'dist');
        const stockApp = path.join(distDir, 'Electron.app');
        const productApp = path.join(distDir, `${productName}.app`);
        const version = readFileSync(path.join(distDir, 'version'), 'utf8').trim();
        const stamp = path.join(distDir, '.qaap-product-bundle-version');
        const current = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : undefined;
        if (current !== version || !existsSync(productApp)) {
            rmSync(productApp, { recursive: true, force: true });
            execFileSync('/bin/cp', ['-c', '-R', stockApp, productApp]);
            const plist = path.join(productApp, 'Contents', 'Info.plist');
            execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleIdentifier', '-string', 'dev.qaaq.desktop.dev', plist]);
            for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
                execFileSync('/usr/bin/plutil', ['-replace', key, '-string', productName, plist]);
            }
            writeFileSync(stamp, version);
            execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
                ['-f', productApp], { stdio: 'ignore' });
        }
        const pathFile = path.join(electronRoot, 'path.txt');
        const target = `${productName}.app/Contents/MacOS/Electron`;
        if (readFileSync(pathFile, 'utf8') !== target) {
            writeFileSync(pathFile, target);
        }
        // The earlier symlink layout (node_modules/electron/qaap-dev) is no longer used.
        rmSync(path.join(electronRoot, 'qaap-dev'), { recursive: true, force: true });
    } catch (error) {
        console.warn(`[qaap] Could not prepare the ${productName}.app dev bundle: ${error instanceof Error ? error.message : error}`);
    }
}

useProductNamedDevBundle('Qaap');

const child = spawn('theia', ['start', ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    // npm puts the package's `node_modules/.bin` on PATH; on Windows `theia` is a `.cmd` shim.
    shell: isWindows,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
}

child.once('error', error => {
    console.error(`[qaap] Could not start the Electron app: ${error.message}`);
    process.exitCode = 1;
});

child.once('exit', (code, signal) => {
    if (signal) {
        console.error(`[qaap] Electron app exited after ${signal}`);
        process.exitCode = 1;
    } else {
        process.exitCode = code ?? 1;
    }
});
