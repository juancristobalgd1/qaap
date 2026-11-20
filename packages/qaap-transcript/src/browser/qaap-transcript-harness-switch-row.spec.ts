// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapCreateAgentTaskQaiqModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import type { QaapAgentMessageDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    createTranscriptHarnessSwitchElement,
    resolveTranscriptComposerHarnessSelection,
    resolveTranscriptHarnessSwitchAt,
    syncTranscriptPendingHarnessSwitchRow,
    TRANSCRIPT_HARNESS_SWITCH_CLASS,
} from './qaap-transcript-harness-switch-row';

const opus: QaapCreateAgentTaskQaiqModel = { provider: 'anthropic', vendor: 'anthropic', modelId: 'claude-opus-5-5' };

function message(id: string, role: 'user' | 'agent', turnAgentId?: string): QaapAgentMessageDTO {
    return { id, role, content: id, createdAt: 0, ...(turnAgentId ? { turnAgentId } : {}) };
}

describe('qaap-transcript-harness-switch-row', () => {

    useSuiteJSDOM();

    it('renders an accessible settled divider with both harnesses and the model', () => {
        const row = createTranscriptHarnessSwitchElement(
            { from: { agentId: 'claude', model: opus }, to: { agentId: 'codex' } },
            { pending: false },
        );
        const separator = row.querySelector('[role="separator"]');
        expect(separator?.getAttribute('aria-label')).to.contain('Switched harness').and.contain('Codex');
        expect(row.classList.contains('theia-mod-pending')).to.equal(false);
        expect(row.querySelector(`.${TRANSCRIPT_HARNESS_SWITCH_CLASS}-title`)?.textContent).to.equal('Switched harness');
        expect(row.querySelectorAll('.theia-qaap-agent-brand-icon')).to.have.length(2);
        expect(row.querySelector(`.${TRANSCRIPT_HARNESS_SWITCH_CLASS}-model`)?.textContent).to.equal('Opus 5.5');
        const tooltip = row.querySelector('[role="tooltip"]');
        const chip = row.querySelector<HTMLButtonElement>('button');
        expect(chip?.getAttribute('aria-describedby')).to.equal(tooltip?.id);
        chip!.click();
        expect(row.classList.contains('theia-mod-open')).to.equal(true);
        expect(chip!.getAttribute('aria-expanded')).to.equal('true');
    });

    it('falls back to a codicon for an unknown harness', () => {
        const row = createTranscriptHarnessSwitchElement({ from: { agentId: 'claude' }, to: { agentId: 'mystery-cli' } }, { pending: true });
        expect(!!row.querySelector(`.${TRANSCRIPT_HARNESS_SWITCH_CLASS}-agent.theia-mod-to .codicon-hubot`)).to.equal(true);
        expect(row.querySelector(`.${TRANSCRIPT_HARNESS_SWITCH_CLASS}-title`)?.textContent).to.equal('Handoff pending');
    });

    it('explains that the shell harness gets no conversation context', () => {
        const row = createTranscriptHarnessSwitchElement({ from: { agentId: 'claude' }, to: { agentId: 'shell' } }, { pending: true });
        expect(row.querySelector('[role="tooltip"]')?.textContent).to.contain('no conversation context');
    });

    it('locates the switch on the user turn that changed harness', () => {
        const conv = { messages: [message('u1', 'user', 'claude'), message('a1', 'agent'), message('u2', 'user', 'codex')] };
        expect(resolveTranscriptHarnessSwitchAt(conv, 1)).to.equal(undefined);
        expect(resolveTranscriptHarnessSwitchAt(conv, 2)?.to.agentId).to.equal('codex');
    });

    it('only counts a composer selection made for this conversation', () => {
        expect(resolveTranscriptComposerHarnessSelection({ transcriptComposerPinnedAgentId: 'codex', transcriptComposerPrefsConvId: 'c1' }, 'c1'))
            .to.deep.equal({ agentId: 'codex', model: undefined });
        expect(resolveTranscriptComposerHarnessSelection({ transcriptComposerPinnedAgentId: 'codex', transcriptComposerPrefsConvId: 'c2' }, 'c1'))
            .to.equal(undefined);
    });

    it('keeps the pending marker at the transcript tail and removes it once the switch settles', () => {
        const scroller = document.createElement('div');
        scroller.className = 'theia-mobile-agent-transcript';
        const live = document.createElement('div');
        live.className = 'theia-mobile-agent-live-status';
        scroller.append(document.createElement('div'), live);
        const conv = { id: 'c1', messages: [message('u1', 'user', 'claude'), message('a1', 'agent')] };

        syncTranscriptPendingHarnessSwitchRow(scroller, conv, { agentId: 'codex' });
        const pending = scroller.querySelector(`.${TRANSCRIPT_HARNESS_SWITCH_CLASS}.theia-mod-pending`);
        expect(!!pending).to.equal(true);
        expect(pending!.nextElementSibling).to.equal(live);

        // Idempotent: a second sync keeps the same node.
        syncTranscriptPendingHarnessSwitchRow(scroller, conv, { agentId: 'codex' });
        expect(scroller.querySelectorAll(`.${TRANSCRIPT_HARNESS_SWITCH_CLASS}`)).to.have.length(1);
        expect(scroller.querySelector(`.${TRANSCRIPT_HARNESS_SWITCH_CLASS}`)).to.equal(pending);

        const settled = { id: 'c1', messages: [...conv.messages, message('u2', 'user', 'codex'), message('a2', 'agent')] };
        syncTranscriptPendingHarnessSwitchRow(scroller, settled, { agentId: 'codex' });
        expect(scroller.querySelector(`.${TRANSCRIPT_HARNESS_SWITCH_CLASS}`)).to.equal(null); // eslint-disable-line no-null/no-null
    });
});
