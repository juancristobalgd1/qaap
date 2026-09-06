// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildScopedVerifyRunCommand,
    buildVerifyRunCommand,
    packageJsonDeclaresWorkspaces,
    pickMonorepoVerifyTargets,
    resolveVerifyCheckFromScripts,
} from './qaap-agent-verify-checks';

describe('qaap-agent-verify-checks', () => {

    it('prefers compile over build and test', () => {
        const resolved = resolveVerifyCheckFromScripts({
            test: 'vitest run',
            build: 'vite build',
            compile: 'tsc -b',
        });
        expect(resolved?.script).to.equal('compile');
        expect(resolved?.kind).to.equal('build');
        expect(resolved?.command).to.equal('npm run compile');
    });

    it('falls back to build when compile is missing', () => {
        const resolved = resolveVerifyCheckFromScripts({
            test: 'vitest run',
            build: 'next build',
        });
        expect(resolved?.script).to.equal('build');
        expect(resolved?.command).to.equal('npm run build');
    });

    it('falls back to test when compile and build are missing', () => {
        const resolved = resolveVerifyCheckFromScripts({
            test: 'jest',
            lint: 'eslint .',
        });
        expect(resolved?.script).to.equal('test');
        expect(resolved?.kind).to.equal('test');
    });

    it('returns undefined when no known scripts exist', () => {
        expect(resolveVerifyCheckFromScripts({ dev: 'vite' })).to.equal(undefined);
        expect(resolveVerifyCheckFromScripts(undefined)).to.equal(undefined);
    });

    it('builds package-manager-specific run commands', () => {
        expect(buildVerifyRunCommand('build', 'pnpm')).to.equal('pnpm run build');
        expect(buildVerifyRunCommand('test', 'yarn')).to.equal('yarn test');
        expect(buildVerifyRunCommand('lint', 'bun')).to.equal('bun run lint');
    });

    it('detects a monorepo root via the workspaces field', () => {
        expect(packageJsonDeclaresWorkspaces({ workspaces: ['packages/*'] })).to.equal(true);
        expect(packageJsonDeclaresWorkspaces({ workspaces: { packages: ['artifacts/*'] } })).to.equal(true);
        expect(packageJsonDeclaresWorkspaces({ name: 'single-app', scripts: { build: 'vite build' } })).to.equal(false);
        expect(packageJsonDeclaresWorkspaces({ workspaces: [] })).to.equal(false);
        expect(packageJsonDeclaresWorkspaces(undefined)).to.equal(false);
    });

    it('builds scoped monorepo verify commands', () => {
        expect(buildScopedVerifyRunCommand('compile', '@theia/qaap-mobile-shell', 'lerna'))
            .to.equal('npx lerna run compile --scope @theia/qaap-mobile-shell');
        expect(buildScopedVerifyRunCommand('test', '@app/web', 'pnpm'))
            .to.equal('pnpm --filter @app/web run test');
        expect(buildScopedVerifyRunCommand('build', 'web', 'npm'))
            .to.equal('npm run build --workspace web');
    });

    it('prefers qaap leaf packages for monorepo verify', () => {
        const picked = pickMonorepoVerifyTargets([
            { name: '@theia/core', script: 'compile', kind: 'build' },
            { name: '@theia/qaap-cloud-workspace', script: 'compile', kind: 'build' },
            { name: '@theia/qaap-mobile-shell', script: 'compile', kind: 'build' },
        ]);
        expect(picked.map(entry => entry.name)).to.deep.equal([
            '@theia/qaap-cloud-workspace',
            '@theia/qaap-mobile-shell',
        ]);
    });

});
