// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_BUILTIN_AGENT_DEFINITIONS } from './qaap-builtin-agents';
import { resolveAgentProjectTrustFlags, shouldAskProjectFolderTrust } from './qaap-project-folder-trust';

describe('qaap project folder trust', () => {

    describe('resolveAgentProjectTrustFlags', () => {
        it('maps Pi to --approve when trusted and --no-approve when not', () => {
            expect(resolveAgentProjectTrustFlags('pi', true)).to.equal('--approve');
            expect(resolveAgentProjectTrustFlags('pi', false)).to.equal('--no-approve');
            expect(resolveAgentProjectTrustFlags('PI', true)).to.equal('--approve');
        });

        it('returns no flags for harnesses that have no trust mapping yet', () => {
            for (const agentId of ['codex', 'claude', 'opencode', 'qaiq', 'cursor', undefined]) {
                expect(resolveAgentProjectTrustFlags(agentId, true)).to.equal('');
                expect(resolveAgentProjectTrustFlags(agentId, false)).to.equal('');
            }
        });

        it('keeps the Pi built-in template free of a hard-coded --approve', () => {
            const pi = QAAP_BUILTIN_AGENT_DEFINITIONS.find(definition => definition.id === 'pi');
            expect(pi?.template).to.contain('{trust_flags}');
            expect(pi?.template).to.not.contain('--approve');
        });
    });

    describe('shouldAskProjectFolderTrust', () => {
        it('asks when the decision is undecided and no dialog is open for the folder', () => {
            expect(shouldAskProjectFolderTrust({ decided: false }, false)).to.be.true;
        });

        it('does not ask once a decision exists, trusted or not', () => {
            expect(shouldAskProjectFolderTrust({ decided: true }, false)).to.be.false;
        });

        it('does not ask while the folder was already asked this session', () => {
            expect(shouldAskProjectFolderTrust({ decided: false }, true)).to.be.false;
        });

        it('does not ask when the status could not be read', () => {
            expect(shouldAskProjectFolderTrust(undefined, false)).to.be.false;
        });
    });
});
