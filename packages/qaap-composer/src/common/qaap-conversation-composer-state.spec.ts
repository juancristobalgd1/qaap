// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { conversationToSummary } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { applyConversationComposerPrefs, applyProjectComposerDefaults, buildRuntimeComposerPersistPatch, extractConversationComposerPrefs, extractConversationComposerPrefsFromSummary, formatComposerRunPermissionsLabel, formatConversationExecutionSessionMeta, readConversationComposerDraft, readProjectComposerDefaults, writeConversationComposerDraft } from './qaap-conversation-composer-state';
import { writeStoredAgentModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { readStoredAgentApprovalPolicy, writeStoredAgentApprovalPolicy } from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';

const baseConv = (): QaapAgentConversationDTO => ({
    id: 'conv-1',
    cwd: '/repo',
    agentId: 'opencode',
    title: 'Test',
    status: 'idle',
    createdAt: 1,
    updatedAt: 2,
    messages: [],
});

describe('qaap-conversation-composer-state', () => {
    const storage = new Map<string, string>();

    beforeEach(() => {
        storage.clear();
        (global as unknown as { window: Window }).window = {
            localStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => { storage.set(key, value); },
                removeItem: (key: string) => { storage.delete(key); },
                clear: () => { storage.clear(); },
                key: () => null,
                length: 0,
            },
        } as unknown as Window;
    });

    it('conversationToSummary maps visually settled streaming turns to settled', () => {
        const summary = conversationToSummary({
            ...baseConv(),
            status: 'streaming',
            messages: [{
                id: 'a1',
                role: 'agent',
                content: 'Done.',
                createdAt: 2,
                segments: [{ type: 'text', content: 'Done.' }],
            }],
        });
        expect(summary.status).to.equal('settled');
    });

    it('conversationToSummary includes composer prefs fields', () => {
        const summary = conversationToSummary({
            ...baseConv(),
            agentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'claude-sonnet-4' },
            interactionModeId: 'plan',
            approvalPolicyId: 'approve-for-me',
        });
        expect(summary.agentModel?.modelId).to.equal('claude-sonnet-4');
        expect(summary.interactionModeId).to.equal('plan');
        expect(summary.approvalPolicyId).to.equal('approve-for-me');
    });

    it('formatConversationExecutionSessionMeta prefers the last executed turn', () => {
        const meta = formatConversationExecutionSessionMeta({
            agentId: 'opencode',
            agentModel: { provider: 'openai', vendor: 'openai', modelId: 'gpt-5.6-sol' },
            lastTurnAgentId: 'opencode',
            lastTurnAgentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'claude-sonnet-4' },
        }, id => id === 'opencode' ? 'OpenCode' : id);
        expect(meta).to.equal('OpenCode · claude-sonnet-4');
    });

    it('extractConversationComposerPrefsFromSummary mirrors full conversation extract', () => {
        const fromSummary = extractConversationComposerPrefsFromSummary({
            cwd: '/repo',
            agentId: 'opencode',
            agentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'model-a' },
            interactionModeId: 'plan',
            approvalPolicyId: 'approve-for-me',
        });
        const fromConv = extractConversationComposerPrefs({
            ...baseConv(),
            agentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'model-a' },
            interactionModeId: 'plan',
            approvalPolicyId: 'approve-for-me',
        });
        expect(fromSummary).to.deep.equal(fromConv);
    });

    it('applyConversationComposerPrefs keeps per-conversation model isolated in storage keys', () => {
        const cwd = '/repo';
        applyConversationComposerPrefs({
            agentId: 'opencode',
            agentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'model-a' },
            approvalPolicyId: 'approve-for-me',
            toolApprovalRules: {},
            autoApprove: true,
        }, cwd, 'conv-a');
        applyConversationComposerPrefs({
            agentId: 'opencode',
            agentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'model-b' },
            approvalPolicyId: 'approve-for-me',
            toolApprovalRules: {},
            autoApprove: true,
        }, cwd, 'conv-b');

        const prefsA = extractConversationComposerPrefsFromSummary({
            cwd,
            agentId: 'opencode',
            agentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'model-a' },
        } as QaapAgentConversationSummaryDTO);
        const prefsB = extractConversationComposerPrefsFromSummary({
            cwd,
            agentId: 'opencode',
            agentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'model-b' },
        } as QaapAgentConversationSummaryDTO);

        expect(prefsA?.agentModel?.modelId).to.equal('model-a');
        expect(prefsB?.agentModel?.modelId).to.equal('model-b');
        expect(readConversationComposerDraft('conv-a')).to.equal('');
        writeConversationComposerDraft('conv-a', 'draft a');
        writeConversationComposerDraft('conv-b', 'draft b');
        expect(readConversationComposerDraft('conv-a')).to.equal('draft a');
        expect(readConversationComposerDraft('conv-b')).to.equal('draft b');
    });

    it('applyProjectComposerDefaults resets idle composer away from a prior conversation model', () => {
        const cwd = '/repo';
        writeStoredAgentModel(cwd, 'opencode', {
            provider: 'anthropic',
            vendor: 'anthropic',
            modelId: 'project-default',
        });
        applyConversationComposerPrefs({
            agentId: 'opencode',
            agentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'conversation-only' },
            approvalPolicyId: 'approve-for-me',
            toolApprovalRules: {},
            autoApprove: true,
        }, cwd, 'conv-old');

        const runtime = applyProjectComposerDefaults(cwd, 'opencode');
        expect(runtime.conversationId).to.be.undefined;
        expect(runtime.agentModel?.modelId).to.equal('project-default');
    });

    it('a summary without approvalPolicyId does not overwrite the stored project policy', () => {
        const cwd = '/repo';
        writeStoredAgentApprovalPolicy(cwd, 'request-approval');
        // Optimistic / partial summary seeded right after submit: no approval fields at all.
        const prefs = extractConversationComposerPrefsFromSummary({
            cwd,
            agentId: 'opencode',
            agentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'big-pickle' },
        } as QaapAgentConversationSummaryDTO);
        expect(prefs?.approvalPolicyId).to.equal('request-approval');
        expect(prefs?.autoApprove).to.equal(false);
        applyConversationComposerPrefs(prefs!, cwd, 'conv-new');
        expect(readStoredAgentApprovalPolicy(cwd)).to.equal('request-approval');
    });

    it('hydrating another conversation never rewrites the project approval policy', () => {
        const cwd = '/repo';
        writeStoredAgentApprovalPolicy(cwd, 'request-approval');
        const prefs = extractConversationComposerPrefs({ ...baseConv(), approvalPolicyId: 'approve-for-me' });
        expect(prefs.approvalPolicyId).to.equal('approve-for-me');
        applyConversationComposerPrefs(prefs, cwd, 'conv-old');
        expect(readStoredAgentApprovalPolicy(cwd)).to.equal('request-approval');
        expect(readProjectComposerDefaults(cwd, 'opencode').approvalPolicyId).to.equal('request-approval');
    });

    it('a conversation created from the sticky composer keeps request-approval through summary hydration', () => {
        const conv = { ...baseConv(), approvalPolicyId: 'request-approval', autoApprove: false };
        const prefs = extractConversationComposerPrefsFromSummary(conversationToSummary(conv));
        expect(prefs?.approvalPolicyId).to.equal('request-approval');
        expect(prefs?.autoApprove).to.equal(false);
    });

    it('formatComposerRunPermissionsLabel joins mode and policy', () => {
        expect(formatComposerRunPermissionsLabel('Build', 'request-approval')).to.equal('Build · Request approval');
        expect(formatComposerRunPermissionsLabel(undefined, 'full-access')).to.equal('Full access');
    });

    it('buildRuntimeComposerPersistPatch prefers explicit runtime model', () => {
        const patch = buildRuntimeComposerPersistPatch('opencode', '/repo', {
            agentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'picked-model' },
            modeId: 'plan',
            approvalPolicyId: 'approve-for-me',
        });
        expect(patch.agentModel?.modelId).to.equal('picked-model');
        expect(patch.interactionModeId).to.equal('plan');
    });
});
