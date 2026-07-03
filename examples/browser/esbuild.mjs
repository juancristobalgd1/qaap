/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { exposeModulePlugin } from '@theia/bundle-plugin';
import esbuild from 'esbuild';

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

const mainOptions = {
    ...browserOptions,
    entryPoints: mainEntryPoints,
    format: 'esm',
    splitting: true,
    chunkNames: 'chunk-[hash]',
    // Interop plugin FIRST: esbuild gives the file to the first onLoad that
    // returns contents, and exposeModulePlugin also intercepts .js files.
    plugins: [esmDiInteropPlugin, ...browserOptions.plugins],
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
