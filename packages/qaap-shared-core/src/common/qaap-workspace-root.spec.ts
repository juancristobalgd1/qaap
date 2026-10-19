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
    resolveWorkspacePreviewBuildScript,
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

        it('finds pnpm and lerna-only roots', async () => {
            const pnpm = fakeTree({ '/ws': { packageJson: {}, pnpmPackages: ['apps/*'] } });
            expect((await findQaapWorkspaceRoot('/ws/apps/web', pnpm.read))?.rootDir).to.equal('/ws');
            const lerna = fakeTree({ '/ws': { packageJson: {}, lernaJson: {} } });
            expect((await findQaapWorkspaceRoot('/ws/packages/app', lerna.read))?.relativePath).to.equal('packages/app');
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

    describe('resolveWorkspacePreviewBuildScript', () => {
        const scripts = { start: 'theia start', build: 'theiaext build && npm run -s bundle' };

        it('builds before a generic start script whose output is missing', () => {
            expect(resolveWorkspacePreviewBuildScript({ scriptKey: 'start', scripts, genericKind: true, buildOutputPresent: false }))
                .to.equal('build');
        });

        it('skips the build when output exists, for dev scripts, frameworks and packages without build', () => {
            expect(resolveWorkspacePreviewBuildScript({ scriptKey: 'start', scripts, genericKind: true, buildOutputPresent: true })).to.equal(undefined);
            expect(resolveWorkspacePreviewBuildScript({ scriptKey: 'dev', scripts, genericKind: true, buildOutputPresent: false })).to.equal(undefined);
            expect(resolveWorkspacePreviewBuildScript({ scriptKey: 'start', scripts, genericKind: false, buildOutputPresent: false })).to.equal(undefined);
            expect(resolveWorkspacePreviewBuildScript({ scriptKey: 'start', scripts: { start: 'x' }, genericKind: true, buildOutputPresent: false }))
                .to.equal(undefined);
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
            })).to.equal("pnpm --filter 'o'\\''web' build && pnpm --filter 'o'\\''web' start");
        });
    });
});
