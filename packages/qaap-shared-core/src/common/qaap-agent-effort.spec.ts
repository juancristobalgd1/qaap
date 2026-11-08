// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentEffort } from './qaap-agent-effort';

describe('qaap-agent-effort', () => {
    describe('support', () => {
        it('lists the Claude levels with high as the default', () => {
            expect(QaapAgentEffort.support('claude', 'claude-opus-4-6')).to.deep.equal({
                levels: ['low', 'medium', 'high', 'xhigh', 'max'],
                defaultLevel: 'high',
            });
        });

        it('lists the Codex levels with medium as the default', () => {
            expect(QaapAgentEffort.support('codex', 'gpt-5.6-sol')?.levels).to.deep.equal(['minimal', 'low', 'medium', 'high', 'xhigh']);
            expect(QaapAgentEffort.support('codex', 'gpt-5.6-sol')?.defaultLevel).to.equal('medium');
        });

        it('lists the Pi levels including off', () => {
            expect(QaapAgentEffort.support('pi', undefined)?.levels[0]).to.equal('off');
        });

        it('gives OpenCode paid models effort but not its free models', () => {
            expect(QaapAgentEffort.support('opencode', 'opencode/big-pickle')).to.equal(undefined);
            expect(QaapAgentEffort.support('opencode', 'opencode/beam-free')).to.equal(undefined);
            expect(QaapAgentEffort.support('opencode', 'opencode/some-paid-model')?.levels).to.deep.equal(['minimal', 'low', 'medium', 'high', 'max']);
        });

        it('returns undefined for harnesses without an effort setting', () => {
            expect(QaapAgentEffort.support('qaiq', 'gpt-5.5')).to.equal(undefined);
            expect(QaapAgentEffort.support('grok', undefined)).to.equal(undefined);
            expect(QaapAgentEffort.support('cursor', undefined)).to.equal(undefined);
        });
    });

    describe('normalize', () => {
        it('keeps a level the harness supports', () => {
            expect(QaapAgentEffort.normalize('claude', undefined, 'max')).to.equal('max');
            expect(QaapAgentEffort.normalize('codex', undefined, ' High ')).to.equal('high');
        });

        it('drops a level the harness does not support', () => {
            expect(QaapAgentEffort.normalize('codex', undefined, 'max')).to.equal(undefined);
            expect(QaapAgentEffort.normalize('claude', undefined, 'off')).to.equal(undefined);
        });

        it('drops every level for an unsupported harness or missing value', () => {
            expect(QaapAgentEffort.normalize('grok', undefined, 'high')).to.equal(undefined);
            expect(QaapAgentEffort.normalize('claude', undefined, undefined)).to.equal(undefined);
            expect(QaapAgentEffort.normalize('claude', undefined, '')).to.equal(undefined);
        });
    });

    describe('parse', () => {
        it('accepts only known level names', () => {
            expect(QaapAgentEffort.parse('xhigh')).to.equal('xhigh');
            expect(QaapAgentEffort.parse(' MAX ')).to.equal('max');
            expect(QaapAgentEffort.parse('ultra')).to.equal(undefined);
            expect(QaapAgentEffort.parse(3)).to.equal(undefined);
            expect(QaapAgentEffort.parse(undefined)).to.equal(undefined);
        });
    });

    describe('label', () => {
        it('names each level', () => {
            expect(QaapAgentEffort.label('xhigh')).to.equal('Extra high');
            expect(QaapAgentEffort.label('max')).to.equal('Max');
            expect(QaapAgentEffort.label('off')).to.equal('Off');
        });
    });
});
