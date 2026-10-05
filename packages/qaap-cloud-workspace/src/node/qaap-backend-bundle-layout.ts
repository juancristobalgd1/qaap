// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';

export interface QaapBackendBundleLayoutOptions {
    /** The app project, `/app/examples/browser` in the image. */
    readonly appRoot: string;
    readonly platform?: NodeJS.Platform;
    readonly arch?: string;
    /** `require()` every native module the bundle needs (only meaningful on the image's own platform). */
    readonly loadNative?: boolean;
}

export interface QaapBackendBundleLayoutProblem {
    /** Absolute path that is missing or fails to load. */
    readonly path: string;
    /** Why the backend needs it: a bundle file, a launch command or the generated esbuild config. */
    readonly source: string;
    readonly reason: 'missing' | 'empty' | 'load-failed';
    readonly detail?: string;
}

export interface QaapBackendBundleLayoutReport {
    readonly checked: number;
    /** Each one breaks the backend (or a feature of it) when it runs from `lib/backend/main.js`. */
    readonly problems: QaapBackendBundleLayoutProblem[];
    /** Missing fallback candidates that the backend tolerates; see {@link QaapBackendBundleLayoutCheck.optionalPaths}. */
    readonly toleratedMissing: QaapBackendBundleLayoutProblem[];
}

interface QaapBackendBundleRequirement {
    readonly path: string;
    readonly source: string;
    readonly kind: 'file' | 'directory';
}

/**
 * Checks that everything the esbuild backend bundle (`lib/backend/main.js` and its sibling entries)
 * loads by path at runtime exists in an application layout. In the bundle every module's `__dirname`
 * is `<appRoot>/lib/backend`, so paths that packages compute relative to their own directory change.
 * See doc/qaap-backend-bundle.md. Run in an image through `scripts/qaap-backend-bundle-layout-check.js`.
 */
export class QaapBackendBundleLayoutCheck {

    /**
     * Paths relative to `<appRoot>/lib/backend` that bundled code computes but only uses as a
     * fallback, with the reason a miss is harmless.
     */
    static readonly optionalPaths: ReadonlyMap<string, string> = new Map([
        ['scanners/backend-init-theia.js', 'plugin-host-rpc.ts fallback when a scanner sets no backendInitPath (upstream)'],
        ['../../../qaap-product/resources/qaap-system-skills', 'qaap-system-skills-env.ts first candidate; QAAP_SYSTEM_SKILLS_DIR and later candidates win'],
        ['../../resources/legal', 'qaap-immutable-chunk-cache-contribution.ts fallback; lib/frontend/legal is used first'],
    ]);

    constructor(protected readonly options: QaapBackendBundleLayoutOptions) { }

    run(): QaapBackendBundleLayoutReport {
        const problems: QaapBackendBundleLayoutProblem[] = [];
        const toleratedMissing: QaapBackendBundleLayoutProblem[] = [];
        const seen = new Set<string>();
        let checked = 0;
        const requirements = [...this.fixedRequirements(), ...this.entryRequirements()];
        for (const bundleFile of this.bundleFiles()) {
            requirements.push(...this.scannedRequirements(bundleFile));
        }
        for (const requirement of requirements) {
            // `plugin-host` (forked by path) and `plugin-host.js` (bundle entry) are the same module.
            const key = requirement.path.replace(/\.js$/, '');
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            checked += 1;
            const problem = this.check(requirement);
            if (!problem) {
                continue;
            }
            const optional = QaapBackendBundleLayoutCheck.optionalPaths.get(path.relative(this.backendDir, requirement.path).split(path.sep).join('/'));
            if (optional && problem.reason === 'missing') {
                toleratedMissing.push({ ...problem, detail: optional });
            } else {
                problems.push(problem);
            }
        }
        return { checked, problems, toleratedMissing };
    }

    protected get appRoot(): string {
        return path.resolve(this.options.appRoot);
    }

    protected get backendDir(): string {
        return path.join(this.appRoot, 'lib', 'backend');
    }

    protected get platform(): NodeJS.Platform {
        return this.options.platform ?? process.platform;
    }

    protected get arch(): string {
        return this.options.arch ?? process.arch;
    }

    /** Needed by every backend start, or by the bundle in places no string literal reveals. */
    protected fixedRequirements(): QaapBackendBundleRequirement[] {
        const repositoryRoot = path.resolve(this.appRoot, '..', '..');
        const command = 'Dockerfile CMD / tenantBackendCommand()';
        const requirements: QaapBackendBundleRequirement[] = [
            { path: path.join(this.backendDir, 'main.js'), source: `${command} with QAAP_BACKEND_ENTRY=lib/backend/main.js`, kind: 'file' },
            { path: path.join(this.appRoot, 'package.json'), source: 'ApplicationPackage (BackendApplicationPath)', kind: 'file' },
            { path: path.join(this.appRoot, 'lib', 'frontend', 'index.html'), source: 'backend static frontend (../../lib/frontend)', kind: 'file' },
            { path: path.join(repositoryRoot, 'plugins'), source: `${command} --plugins=local-dir:/app/plugins`, kind: 'directory' },
            { path: path.join(repositoryRoot, 'examples', 'ovsx-router-config.json'), source: `${command} --ovsx-router-config`, kind: 'file' },
            {
                path: path.join(repositoryRoot, 'packages', 'qaap-cloud-workspace', 'lib', 'common', 'qaap-agent-destructive-command-guard.js'),
                source: 'scripts/qaap-guarded-bash.mjs (loads the compiled guard relative to itself)',
                kind: 'file',
            },
            { path: path.join(this.backendDir, 'shell-integrations'), source: 'shell-integration-injector.ts (__dirname/shell-integrations)', kind: 'directory' },
        ];
        if (this.platform !== 'win32') {
            requirements.push({
                // node-pty's loadNativeModule() requires '../prebuilds/<platform>-<arch>/pty.node' relative to
                // the bundle file; bundle-plugin's copyNodePtySpawnHelper() puts it there.
                path: path.join(this.appRoot, 'lib', 'prebuilds', `${this.platform}-${this.arch}`, 'pty.node'),
                source: 'node-pty loadNativeModule (terminals and every tenant spawn)',
                kind: 'file',
            });
        }
        return requirements;
    }

    /** Every entry of the generated esbuild node config becomes `lib/backend/<entry>.js`; the backend forks several of them by path. */
    protected entryRequirements(): QaapBackendBundleRequirement[] {
        const configPath = path.join(this.appRoot, 'gen-esbuild.node.mjs');
        const source = path.relative(this.appRoot, configPath);
        if (!fs.existsSync(configPath)) {
            return [{ path: configPath, source: 'esbuild backend bundle config (lists the bundle entries)', kind: 'file' }];
        }
        const config = fs.readFileSync(configPath, 'utf8');
        const block = /entryPoints\s*:\s*\{([\s\S]*?)\}/.exec(config)?.[1] ?? '';
        const entries = new Set<string>();
        for (const match of block.matchAll(/^\s*(['"])([^'"]+)\1\s*:/gm)) {
            entries.add(match[2]);
        }
        return [...entries]
            // node-pty's ConPTY helpers only run on Windows.
            .filter(entry => this.platform === 'win32' || !/conoutSocketWorker|conpty_console_list_agent/.test(entry))
            .map(entry => ({ path: path.join(this.backendDir, `${entry}.js`), source: `${source} entry '${entry}'`, kind: 'file' as const }));
    }

    protected bundleFiles(): string[] {
        if (!fs.existsSync(this.backendDir)) {
            return [];
        }
        return fs.readdirSync(this.backendDir)
            .filter(name => name.endsWith('.js'))
            .map(name => path.join(this.backendDir, name));
    }

    /**
     * String literals that bundled code turns into paths: `path.join/resolve(__dirname, '…', …)`,
     * `` path.join(__dirname, `…${…}`) `` (prefix only), `__dirname + '…'`, and the `./native/…` assets
     * the esbuild file loader emits for native modules.
     */
    protected scannedRequirements(bundleFile: string): QaapBackendBundleRequirement[] {
        const content = fs.readFileSync(bundleFile, 'utf8');
        const source = path.relative(this.appRoot, bundleFile).split(path.sep).join('/');
        const requirements: QaapBackendBundleRequirement[] = [];
        const add = (target: string): void => {
            requirements.push({ path: target, source, kind: 'file' });
        };
        for (const match of content.matchAll(/__dirname((?:\s*,\s*(?:"[^"\n]*"|'[^'\n]*'))+)/g)) {
            const segments = [...match[1].matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)].map(segment => segment[1] ?? segment[2]);
            add(path.resolve(this.backendDir, ...segments));
        }
        for (const match of content.matchAll(/__dirname\s*,\s*`([^`$\n]*)\$\{/g)) {
            add(path.resolve(this.backendDir, match[1]));
        }
        for (const match of content.matchAll(/__dirname\s*\+\s*(?:"([^"\n]*)"|'([^'\n]*)')/g)) {
            add(path.resolve(this.backendDir + (match[1] ?? match[2])));
        }
        for (const match of content.matchAll(/["'](\.\/native\/[^"'\n]+)["']/g)) {
            add(path.resolve(this.backendDir, match[1]));
        }
        return requirements;
    }

    protected check(requirement: QaapBackendBundleRequirement): QaapBackendBundleLayoutProblem | undefined {
        // `fork(path.join(__dirname, 'plugin-host'))` and `require()` resolve a missing extension like Node does.
        const candidates = requirement.kind === 'file' ? [requirement.path, `${requirement.path}.js`, `${requirement.path}.node`] : [requirement.path];
        const stat = candidates.map(candidate => fs.statSync(candidate, { throwIfNoEntry: false })).find(candidate => candidate !== undefined);
        if (!stat) {
            return { path: requirement.path, source: requirement.source, reason: 'missing' };
        }
        if (requirement.kind === 'directory' && (!stat.isDirectory() || fs.readdirSync(requirement.path).length === 0)) {
            return { path: requirement.path, source: requirement.source, reason: 'empty' };
        }
        if (this.options.loadNative && stat.isFile() && requirement.path.endsWith('.node')) {
            try {
                // Same load the bundle performs: a native module by absolute path.
                module.require(requirement.path);
            } catch (error) {
                return { path: requirement.path, source: requirement.source, reason: 'load-failed', detail: error instanceof Error ? error.message : String(error) };
            }
        }
        return undefined;
    }
}
