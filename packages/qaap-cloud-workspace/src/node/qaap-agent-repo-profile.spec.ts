// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildQaapAgentRepoProfile } from './qaap-agent-repo-profile';

describe('buildQaapAgentRepoProfile', () => {
    let cwd: string;

    beforeEach(() => {
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-repo-profile-'));
    });

    afterEach(() => {
        fs.rmSync(cwd, { recursive: true, force: true });
    });

    it('summarizes framework, package manager, monorepo, and runnable commands', () => {
        fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
            name: 'storefront',
            packageManager: 'pnpm@10.0.0',
            workspaces: ['apps/*'],
            scripts: { dev: 'next dev', build: 'next build', test: 'vitest', lint: 'eslint .' },
            dependencies: { next: '^16.0.0' },
            devDependencies: { vite: '^7.0.0' },
        }));
        fs.writeFileSync(path.join(cwd, 'turbo.json'), '{}');

        const profile = buildQaapAgentRepoProfile(cwd);
        expect(profile).to.contain('Package: storefront');
        expect(profile).to.contain('Package manager: pnpm');
        expect(profile).to.contain('Next.js');
        expect(profile).to.contain('Turborepo');
        expect(profile).to.contain('- pnpm run dev');
        expect(profile).to.contain('- pnpm run test');
    });

    it('provides conventional verification commands for non-Node projects', () => {
        fs.writeFileSync(path.join(cwd, 'Cargo.toml'), '[package]\nname = "demo"\n');
        expect(buildQaapAgentRepoProfile(cwd)).to.contain('cargo test');
    });

    it('returns undefined when no supported project marker exists', () => {
        expect(buildQaapAgentRepoProfile(cwd)).to.equal(undefined);
    });
});
