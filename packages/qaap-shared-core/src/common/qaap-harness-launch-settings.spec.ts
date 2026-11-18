// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    checkQaapHarnessPathShape,
    isQaapHarnessInstanceId,
    nextQaapHarnessInstanceId,
    readQaapHarnessInstances,
    readQaapHarnessSettingsFor,
    readQaapHarnessSettingsMap,
    resolveQaapHarnessBaseId,
    resolveQaapHarnessDisplayLabel,
    resolveQaapHarnessHomeEnvVar,
    withQaapHarnessSettings,
} from './qaap-harness-launch-settings';
import { normalizeBackendAgentId } from './qaap-agent-task-client';
import { resolveAgentBrand } from './qaap-agent-branding';

describe('qaap-harness-launch-settings', () => {

    it('derives instance ids from a base harness and stops at the per-base maximum', () => {
        expect(nextQaapHarnessInstanceId('codex', [])).to.equal('codex#2');
        expect(nextQaapHarnessInstanceId('codex', [{ id: 'codex#2', baseId: 'codex' }])).to.equal('codex#3');
        const full = [2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ id: `codex#${n}`, baseId: 'codex' }));
        expect(nextQaapHarnessInstanceId('codex', full)).to.equal(undefined);
        expect(isQaapHarnessInstanceId('codex#2')).to.equal(true);
        expect(isQaapHarnessInstanceId('codex')).to.equal(false);
        expect(isQaapHarnessInstanceId('codex#1')).to.equal(false);
        expect(resolveQaapHarnessBaseId('Codex#3')).to.equal('codex');
        expect(resolveQaapHarnessBaseId('claude')).to.equal('claude');
    });

    it('keeps only well-formed instances of known harnesses, once', () => {
        const instances = readQaapHarnessInstances([
            { id: 'codex#2', baseId: 'codex' },
            { id: 'codex#2', baseId: 'codex' },
            { id: 'claude#2' },
            { id: 'hermes#2', baseId: 'hermes' },
            { id: 'codex#3', baseId: 'claude' },
            { id: '../codex#2' },
            'codex#4',
        ], ['codex', 'claude']);
        expect(instances).to.deep.equal([
            { id: 'codex#2', baseId: 'codex' },
            { id: 'claude#2', baseId: 'claude' },
        ]);
        expect(readQaapHarnessInstances(undefined, ['codex'])).to.deep.equal([]);
    });

    it('persists settings per harness and restores defaults by removing the entry', () => {
        let stored: unknown = {};
        stored = withQaapHarnessSettings(stored, 'Codex', { label: ' Work Codex ', binaryPath: '/opt/codex/bin/codex', homeDir: '' });
        expect(stored).to.deep.equal({ codex: { label: 'Work Codex', binaryPath: '/opt/codex/bin/codex' } });
        stored = withQaapHarnessSettings(stored, 'codex#2', { homeDir: '/Users/me/.codex-work' });
        expect(readQaapHarnessSettingsFor(stored, 'codex#2')).to.deep.equal({ homeDir: '/Users/me/.codex-work' });
        stored = withQaapHarnessSettings(stored, 'codex', undefined);
        expect(stored).to.deep.equal({ 'codex#2': { homeDir: '/Users/me/.codex-work' } });
        expect(readQaapHarnessSettingsMap({ codex: { label: 42, binaryPath: ['x'] }, '': { label: 'x' } })).to.deep.equal({});
        expect(readQaapHarnessSettingsMap('nope')).to.deep.equal({});
    });

    it('keeps only allowed variable names in the preferences, never values', () => {
        const stored = withQaapHarnessSettings({}, 'codex#2', { envNames: ['OPENAI_API_KEY', 'PATH', 'bad', 'OPENAI_API_KEY', 'QAAP_GATE_TOKEN'] });
        expect(stored).to.deep.equal({ 'codex#2': { envNames: ['OPENAI_API_KEY'] } });
        expect(readQaapHarnessSettingsFor({ codex: { envNames: ['A_KEY'], value: 'secret' } }, 'codex')).to.deep.equal({ envNames: ['A_KEY'] });
    });

    it('names instances after their base harness until the user renames them', () => {
        expect(resolveQaapHarnessDisplayLabel({}, 'codex#2', 'Codex')).to.equal('Codex 2');
        expect(resolveQaapHarnessDisplayLabel({ 'codex#2': { label: 'Codex (work)' } }, 'codex#2', 'Codex')).to.equal('Codex (work)');
        expect(resolveQaapHarnessDisplayLabel({}, 'claude', 'Claude Code')).to.equal('Claude Code');
    });

    it('maps the configuration folder variable only for harnesses whose CLI has one', () => {
        expect(resolveQaapHarnessHomeEnvVar('codex')).to.equal('CODEX_HOME');
        expect(resolveQaapHarnessHomeEnvVar('claude')).to.equal('CLAUDE_CONFIG_DIR');
        expect(resolveQaapHarnessHomeEnvVar('opencode')).to.equal(undefined);
    });

    it('accepts only absolute paths made of plain characters', () => {
        expect(checkQaapHarnessPathShape('/opt/homebrew/bin/codex')).to.equal(undefined);
        expect(checkQaapHarnessPathShape('/Users/me/Library/Application Support/codex')).to.equal(undefined);
        expect(checkQaapHarnessPathShape('C:\\Tools\\codex.exe')).to.equal(undefined);
        expect(checkQaapHarnessPathShape('codex')).to.equal('not-absolute');
        expect(checkQaapHarnessPathShape('~/bin/codex')).to.equal('not-absolute');
        expect(checkQaapHarnessPathShape('/bin/codex; rm -rf ~')).to.equal('unsafe-characters');
        expect(checkQaapHarnessPathShape('/bin/$(whoami)')).to.equal('unsafe-characters');
        expect(checkQaapHarnessPathShape('/bin/`id`')).to.equal('unsafe-characters');
        expect(checkQaapHarnessPathShape('/bin/a"b')).to.equal('unsafe-characters');
        expect(checkQaapHarnessPathShape('/opt/../bin/codex')).to.equal('unsafe-characters');
        expect(checkQaapHarnessPathShape('/bin/co\ndex')).to.equal('unsafe-characters');
        expect(checkQaapHarnessPathShape(`/${'a'.repeat(1100)}`)).to.equal('too-long');
    });

    it('treats an instance id as a runner agent id with its base harness brand', () => {
        expect(normalizeBackendAgentId('codex#2')).to.equal('codex#2');
        expect(normalizeBackendAgentId('nope#2')).to.equal(undefined);
        expect(resolveAgentBrand('codex#2')?.label).to.equal(resolveAgentBrand('codex')?.label);
    });
});
