// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveQaapAgentVerificationScripts } from './qaap-agent-verification';

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
