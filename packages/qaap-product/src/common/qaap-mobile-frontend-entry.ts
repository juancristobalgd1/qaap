// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Build-time derivation of the phone entry (`bundle.mobile.js`) from the generated
 * `src-gen/frontend/index.js`. Phones only ever show the Work Hub, so the entry drops the
 * frontend (and preload) modules that only serve the desktop IDE. Each module is loaded with
 * its own `import()`, i.e. lives in its own chunk, so a dropped module is never fetched.
 *
 * Only leaves of the DI graph are listed: no module kept on mobile imports or injects anything
 * they bind (guarded by `qaap-mobile-frontend-entry-leaves.spec.ts`). In particular
 * `plugin-ext` goes together with everything that injects `HostedPluginSupport`
 * (`plugin-ext-vscode`, `vsx-registry`, `ai-registry`) and the Qaap modules that bind on top of
 * plugin-ext or vsx-registry, so the phone never downloads or starts a plugin host.
 * Do not add `debug`, `console`, `test`, `task`, `search-in-workspace` (injected by `ai-ide`),
 * `getting-started`, `keymaps` (rebound by `qaap-product`), `memory-inspector` (rebound by
 * `qaap-work-hub`) or `toolbar` (`qaap-shell`).
 */
export namespace QaapMobileFrontendEntry {

    export const EXCLUDED_MODULES: ReadonlyArray<string> = [
        '@theia/api-samples/lib/browser/api-samples-preload-module',
        '@theia/api-samples/lib/browser/api-samples-frontend-module',
        '@theia/plugin-ext/lib/plugin-ext-frontend-module',
        '@theia/plugin-ext-vscode/lib/browser/plugin-vscode-frontend-module',
        '@theia/vsx-registry/lib/common/vsx-registry-common-module',
        '@theia/vsx-registry/lib/browser/vsx-registry-frontend-module',
        '@theia/ai-registry/lib/browser/ai-registry-frontend-module',
        '@theia/plugin-dev/lib/browser/plugin-dev-frontend-module',
        '@theia/plugin-metrics/lib/browser/plugin-metrics-frontend-module',
        '@theia/notebook/lib/browser/notebook-frontend-module',
        '@theia/timeline/lib/browser/timeline-frontend-module',
        '@theia/callhierarchy/lib/browser/callhierarchy-frontend-module',
        '@theia/typehierarchy/lib/browser/typehierarchy-frontend-module',
        '@theia/bulk-edit/lib/browser/bulk-edit-frontend-module',
        '@theia/collaboration/lib/browser/collaboration-frontend-module',
        '@theia/scm-extra/lib/browser/scm-extra-frontend-module',
        '@theia/property-view/lib/browser/property-view-frontend-module',
        '@theia/secondary-window/lib/browser/secondary-window-frontend-module',
        '@theia/scanoss/lib/browser/scanoss-frontend-module',
        '@theia/ai-scanoss/lib/browser/ai-scanoss-frontend-module',
        '@theia/metrics/lib/browser/metrics-frontend-module',
        '@theia/ai-code-completion/lib/browser/ai-code-completion-frontend-module',
        '@theia/ai-editor/lib/browser/ai-editor-frontend-module',
        '@theia/ai-history/lib/browser/ai-history-frontend-module',
        '@theia/terminal-manager/lib/browser/terminal-manager-frontend-module',
        '@theia/qaap-product/lib/browser/qaap-product-plugin-frontend-module',
        '@theia/qaap-work-hub/lib/browser/qaap-work-hub-vsx-frontend-module',
    ];

    const MODULE_LOAD_LINE = /^\s*await load\(container, (?:import|require)\('([^']+)'\)\);\s*$/;

    /**
     * Returns `source` without the `await load(container, import('<module>'))` lines of
     * {@link EXCLUDED_MODULES}; line endings are preserved. Throws when no module line is found
     * at all, so a change in the generator's output fails the build instead of shipping the
     * full IDE to phones unnoticed.
     */
    export function create(source: string): string {
        const lines = source.split(/(?<=\n)/);
        let moduleLines = 0;
        const kept = lines.filter(line => {
            const match = MODULE_LOAD_LINE.exec(line);
            if (!match) {
                return true;
            }
            moduleLines++;
            return !EXCLUDED_MODULES.includes(match[1]);
        });
        if (moduleLines === 0) {
            throw new Error('qaap mobile entry: no `await load(container, import(...))` lines in the generated frontend entry');
        }
        return kept.join('');
    }
}
