// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QaapWorkspaceManifests,
    buildQaapWorkspaceScriptCommand,
    extractScriptBinary,
    findQaapWorkspaceRoot,
    isQaapInstalledBinary,
    parseQaapPreviewBuildPolicy,
    qaapTenantRepositoryCeiling,
    resolveQaapPreviewBuildPlan,
    scriptBuildOutputDir,
    workspaceGlobMatches,
    workspaceMemberPatterns,
} from './qaap-workspace-root';

/** File-system stand-in: manifests per directory and the directories holding `.git`. */
function fakeTree(manifests: Record<string, QaapWorkspaceManifests>, gitRoots: string[] = []): {
    read: (dir: string) => Promise<QaapWorkspaceManifests | undefined>;
    isBoundary: (dir: string) => Promise<boolean>;
} {
    return {
        read: async dir => manifests[dir],
        isBoundary: async dir => gitRoots.includes(dir),
    };
}

describe('qaap-workspace-root', () => {

    describe('workspaceMemberPatterns', () => {
        it('reads npm/yarn workspaces arrays and yarn { packages } objects', () => {
            expect(workspaceMemberPatterns({ packageJson: { workspaces: ['dev-packages/*', './examples/*/'] } }))
                .to.deep.equal(['dev-packages/*', 'examples/*']);
            expect(workspaceMemberPatterns({ packageJson: { workspaces: { packages: ['apps/*'], nohoist: ['**/x'] } } }))
                .to.deep.equal(['apps/*']);
        });

        it('prefers pnpm-workspace.yaml and drops negations', () => {
            expect(workspaceMemberPatterns({
                pnpmPackages: ['apps/*', '!apps/legacy'],
                packageJson: { workspaces: ['ignored/*'] },
            })).to.deep.equal(['apps/*']);
        });

        it('falls back to lerna packages, defaulting to packages/*', () => {
            expect(workspaceMemberPatterns({ packageJson: {}, lernaJson: { packages: ['modules/*'] } })).to.deep.equal(['modules/*']);
            expect(workspaceMemberPatterns({ lernaJson: {} })).to.deep.equal(['packages/*']);
        });

        it('returns nothing for a standalone package', () => {
            expect(workspaceMemberPatterns({ packageJson: { workspaces: undefined } })).to.deep.equal([]);
        });
    });

    describe('workspaceGlobMatches', () => {
        it('matches one segment per * and any depth for **', () => {
            expect(workspaceGlobMatches('examples/browser', 'examples/*')).to.equal(true);
            expect(workspaceGlobMatches('sample-plugins/a/b', 'sample-plugins/*/*')).to.equal(true);
            expect(workspaceGlobMatches('examples/browser/lib', 'examples/*')).to.equal(false);
            expect(workspaceGlobMatches('apps/web/admin', 'apps/**')).to.equal(true);
            expect(workspaceGlobMatches('apps/web', 'apps/web')).to.equal(true);
            expect(workspaceGlobMatches('packages/ui-kit', 'packages/ui-*')).to.equal(true);
            expect(workspaceGlobMatches('tools/web', 'apps/*')).to.equal(false);
        });
    });

    describe('findQaapWorkspaceRoot', () => {
        it('finds the npm workspace root that lists the package (Theia examples/browser)', async () => {
            const tree = fakeTree({
                '/repo': { packageJson: { workspaces: ['dev-packages/*', 'packages/*', 'examples/*'] }, lernaJson: {} },
            }, ['/repo']);
            expect(await findQaapWorkspaceRoot('/repo/examples/browser', tree.read, { isBoundary: tree.isBoundary }))
                .to.deep.equal({ rootDir: '/repo', relativePath: 'examples/browser' });
        });

        it('finds pnpm roots but not lerna-only roots (a root install does not install their members)', async () => {
            const pnpm = fakeTree({ '/ws': { packageJson: {}, pnpmPackages: ['apps/*'] } });
            expect((await findQaapWorkspaceRoot('/ws/apps/web', pnpm.read))?.rootDir).to.equal('/ws');
            const lerna = fakeTree({ '/ws': { packageJson: {}, lernaJson: {} } });
            expect(await findQaapWorkspaceRoot('/ws/packages/app', lerna.read)).to.equal(undefined);
        });

        it('never reads above the open workspace roots or the tenant repository area', async () => {
            const tree = fakeTree({
                '/projects': { packageJson: { workspaces: ['**'] } },
                '/workspace/repos/users': { packageJson: { workspaces: ['**'] } },
            });
            expect(await findQaapWorkspaceRoot('/projects/site/app', tree.read, { ceilingDirs: ['/projects/site'] })).to.equal(undefined);
            expect(await findQaapWorkspaceRoot('/workspace/repos/users/alice/app', tree.read)).to.equal(undefined);
        });

        it('ignores an ancestor whose workspaces do not include the package', async () => {
            const tree = fakeTree({ '/ws': { packageJson: { workspaces: ['apps/*'] } } });
            expect(await findQaapWorkspaceRoot('/ws/tools/cli', tree.read)).to.equal(undefined);
        });

        it('never walks above a git checkout root', async () => {
            const tree = fakeTree({ '/users/me': { packageJson: { workspaces: ['**'] } } }, ['/users/me/repo']);
            expect(await findQaapWorkspaceRoot('/users/me/repo', tree.read, { isBoundary: tree.isBoundary })).to.equal(undefined);
            expect(await findQaapWorkspaceRoot('/users/me/repo/app', tree.read, { isBoundary: tree.isBoundary })).to.equal(undefined);
        });

        it('stops after maxDepth levels', async () => {
            const tree = fakeTree({ '/ws': { packageJson: { workspaces: ['a/**'] } } });
            expect(await findQaapWorkspaceRoot('/ws/a/b/c/d', tree.read, { maxDepth: 2 })).to.equal(undefined);
            expect((await findQaapWorkspaceRoot('/ws/a/b/c/d', tree.read, { maxDepth: 4 }))?.rootDir).to.equal('/ws');
        });
    });

    describe('extractScriptBinary', () => {
        it('returns the bin a script starts with', () => {
            expect(extractScriptBinary('theia start --log-level=warn --plugins=local-dir:../../plugins')).to.equal('theia');
            expect(extractScriptBinary('cross-env NODE_OPTIONS=--max-old-space-size=4096 vite --host')).to.equal('vite');
            expect(extractScriptBinary('PORT=4000 next dev && echo done')).to.equal('next');
            expect(extractScriptBinary('@scope-cli serve')).to.equal('@scope-cli');
        });

        it('ignores package managers, runtimes, builtins and paths', () => {
            expect(extractScriptBinary('npm run dev --workspace web')).to.equal(undefined);
            expect(extractScriptBinary('node dist/server.js')).to.equal(undefined);
            expect(extractScriptBinary('cd app && vite')).to.equal(undefined);
            expect(extractScriptBinary('./scripts/dev.sh')).to.equal(undefined);
            expect(extractScriptBinary('')).to.equal(undefined);
        });
    });

    describe('resolveQaapPreviewBuildPlan (build is opt-in only)', () => {
        const scripts = { start: 'theia start', build: 'theiaext build && npm run -s bundle' };
        const none = (): boolean => false;
        const base = { scriptKey: 'start', script: 'theia start', scripts, genericKind: true, outputDirExists: none };

        it('never chains a build without the opt-in, even when the output is missing (Theia monorepo)', () => {
            expect(resolveQaapPreviewBuildPlan({ ...base, policy: 'manual' })).to.deep.equal({ buildRequired: false });
        });

        it('chains the build only with "build": "auto" and missing output', () => {
            expect(resolveQaapPreviewBuildPlan({ ...base, policy: 'auto' })).to.deep.equal({ buildScript: 'build', buildRequired: false });
            expect(resolveQaapPreviewBuildPlan({ ...base, policy: 'auto', outputDirExists: dir => dir === 'lib' }))
                .to.deep.equal({ buildRequired: false });
        });

        it('reports buildRequired (fail fast) when the script names a missing output folder and there is no opt-in', () => {
            const plan = resolveQaapPreviewBuildPlan({ ...base, script: 'node dist/server.js', policy: 'manual' });
            expect(plan).to.deep.equal({ buildRequired: true, missingOutputDir: 'dist' });
            expect(resolveQaapPreviewBuildPlan({ ...base, script: 'node dist/server.js', policy: 'manual', outputDirExists: dir => dir === 'dist' }))
                .to.deep.equal({ buildRequired: false });
        });

        it('does not report build-required for a script that creates its output folder itself', () => {
            expect(resolveQaapPreviewBuildPlan({ ...base, script: 'node server.js --out dist', policy: 'manual' }))
                .to.deep.equal({ buildRequired: false });
        });

        it('never builds dev scripts, framework dev servers or packages without a build script', () => {
            expect(resolveQaapPreviewBuildPlan({ ...base, scriptKey: 'dev', policy: 'auto' }).buildScript).to.equal(undefined);
            expect(resolveQaapPreviewBuildPlan({ ...base, genericKind: false, policy: 'auto' }).buildScript).to.equal(undefined);
            expect(resolveQaapPreviewBuildPlan({ ...base, scripts: { start: 'x' }, policy: 'auto' }).buildScript).to.equal(undefined);
        });
    });

    describe('scriptBuildOutputDir', () => {
        it('finds the output folder a script runs from', () => {
            expect(scriptBuildOutputDir('node dist/server.js')).to.equal('dist');
            expect(scriptBuildOutputDir('serve -s build')).to.equal('build');
            expect(scriptBuildOutputDir('NODE_ENV=production node ./lib/main.js')).to.equal('lib');
            expect(scriptBuildOutputDir('http-server out -p 8080')).to.equal('out');
            expect(scriptBuildOutputDir('cd lib && node main.js')).to.equal('lib');
        });

        it('never mistakes a command or a script name for a folder', () => {
            expect(scriptBuildOutputDir('theia start --plugins=local-dir:../../plugins')).to.equal(undefined);
            expect(scriptBuildOutputDir('npm run build && node server.js')).to.equal(undefined);
            expect(scriptBuildOutputDir('yarn build && serve')).to.equal(undefined);
            expect(scriptBuildOutputDir('build')).to.equal(undefined);
            // Later arguments and flag values are folders the script may create itself.
            expect(scriptBuildOutputDir('node server.js --out dist')).to.equal(undefined);
            expect(scriptBuildOutputDir('node server.js --out=dist')).to.equal(undefined);
            expect(scriptBuildOutputDir('webpack --output-path dist && serve -s public')).to.equal(undefined);
        });
    });

    describe('parseQaapPreviewBuildPolicy', () => {
        it('accepts only the explicit "auto" opt-in', () => {
            expect(parseQaapPreviewBuildPolicy({ build: 'auto' })).to.equal('auto');
            expect(parseQaapPreviewBuildPolicy({ build: true })).to.equal('manual');
            expect(parseQaapPreviewBuildPolicy({})).to.equal('manual');
            expect(parseQaapPreviewBuildPolicy(undefined)).to.equal('manual');
        });
    });

    describe('isQaapInstalledBinary', () => {
        it('treats dependency and workspace bins as install output, system tools as not', () => {
            expect(isQaapInstalledBinary('theia', { dependencyNames: ['@theia/cli'] })).to.equal(true);
            expect(isQaapInstalledBinary('vite', { dependencyNames: ['vite'] })).to.equal(true);
            expect(isQaapInstalledBinary('fixture-serve', { dependencyNames: [], workspaceBins: new Set(['fixture-serve']) })).to.equal(true);
            expect(isQaapInstalledBinary('docker', { dependencyNames: ['vite'] })).to.equal(false);
        });
    });

    describe('qaapTenantRepositoryCeiling', () => {
        it('bounds discovery to the tenant repository area', () => {
            expect(qaapTenantRepositoryCeiling('/workspace/repos/users/alice/qaap/examples/browser')).to.equal('/workspace/repos/users/alice');
            expect(qaapTenantRepositoryCeiling('/Users/jc/qaap')).to.equal(undefined);
        });
    });

    describe('buildQaapWorkspaceScriptCommand', () => {
        it('runs member scripts with each package manager', () => {
            const base = { packageName: '@theia/example-browser', script: 'start' };
            expect(buildQaapWorkspaceScriptCommand({ ...base, packageManager: 'npm' })).to.equal('npm run start');
            expect(buildQaapWorkspaceScriptCommand({ ...base, packageManager: 'yarn' })).to.equal('yarn start');
            expect(buildQaapWorkspaceScriptCommand({ ...base, packageManager: 'bun' })).to.equal('bun run start');
            expect(buildQaapWorkspaceScriptCommand({ ...base, packageManager: 'pnpm' })).to.equal("pnpm --filter '@theia/example-browser' start");
        });

        it('chains the build before the preview script', () => {
            expect(buildQaapWorkspaceScriptCommand({
                packageManager: 'npm', packageName: '@theia/example-browser', script: 'start', buildScript: 'build',
            })).to.equal('npm run build && npm run start');
            expect(buildQaapWorkspaceScriptCommand({
                packageManager: 'pnpm', packageName: "o'web", script: 'start', buildScript: 'build',
            })).to.equal("pnpm --filter 'o'\\''web...' build && pnpm --filter 'o'\\''web' start");
        });
    });
});
