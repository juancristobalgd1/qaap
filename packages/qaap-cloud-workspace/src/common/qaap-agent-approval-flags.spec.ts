// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    applyAgentApprovalPolicyToCommand,
    resolveEffectiveToolApprovalRules,
    shouldUseInteractiveAgentApprovals,
    shouldUseQaiqStdioApprovals,
} from './qaap-agent-approval-flags';

describe('qaap-agent-approval-flags', () => {

    it('resolveEffectiveToolApprovalRules maps presets to scopes', () => {
        expect(resolveEffectiveToolApprovalRules('request-approval', { shell: true, network: true }))
            .to.deep.equal({ shell: false, network: false });
        expect(resolveEffectiveToolApprovalRules('full-access', { shell: false, network: false }))
            .to.deep.equal({ shell: true, network: true });
        expect(resolveEffectiveToolApprovalRules('approve-for-me', { shell: true, network: false }))
            .to.deep.equal({ shell: true, network: false });
    });

    it('approve-for-me uses OpenCode-style skip for QAIQ headless runs', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "qaiq --print -p 'hi'",
            { agentId: 'qaiq', approvalPolicyId: 'approve-for-me', autoApprove: true },
        );
        expect(command).to.include('--dangerously-skip-permissions');
        expect(command).to.include('--tools Read,Write,Edit,Bash,Grep,Glob,NotebookEdit,TodoWrite,Agent');
        expect(command).to.include('--disallowed-tools');
        expect(command).to.include('Task');
        expect(command).to.include('Skill');
        expect(command).not.to.include('--allowed-tools');
    });

    it('approve-for-me strips template acceptEdits before injecting skip-permissions', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "qaiq --permission-mode acceptEdits --print -p 'hi'",
            { agentId: 'qaiq', approvalPolicyId: 'approve-for-me', autoApprove: true },
        );
        expect(command).to.include('--dangerously-skip-permissions');
        expect(command).not.to.include('acceptEdits');
    });

    it('approve-for-me blocks QAIQ headless tools under skip-permissions', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "qaiq --print -p 'hi'",
            { agentId: 'qaiq', approvalPolicyId: 'approve-for-me', autoApprove: true },
        );
        expect(command).to.include('--disallowed-tools');
        expect(command).to.include('AskUserQuestion');
    });

    it('full-access includes network tools in the QAIQ core allowlist', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "qaiq --print -p 'hi'",
            { agentId: 'qaiq', approvalPolicyId: 'full-access', autoApprove: true },
        );
        expect(command).to.include('--tools Read,Write,Edit,Bash,Grep,Glob,NotebookEdit,TodoWrite,Agent,WebFetch,WebSearch');
    });

    it('full-access still blocks headless tools on QAIQ', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "qaiq --print -p 'hi'",
            { agentId: 'qaiq', approvalPolicyId: 'full-access', autoApprove: true },
        );
        expect(command).to.include('--disallowed-tools');
    });

    it('approve-for-me uses acceptEdits for Claude when shell is disabled', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "claude --print -p 'hi'",
            {
                agentId: 'claude',
                approvalPolicyId: 'approve-for-me',
                autoApprove: true,
                toolApprovalRules: { shell: false, network: false },
            },
        );
        expect(command).to.include('--permission-mode acceptEdits');
        expect(command).not.to.include('--dangerously-skip-permissions');
    });

    it('approve-for-me enables Bash for Claude by default', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "claude --print -p 'hi'",
            { agentId: 'claude', approvalPolicyId: 'approve-for-me', autoApprove: true },
        );
        expect(command).to.include('--allowed-tools');
        expect(command).to.include('Bash');
        expect(command).not.to.include('--dangerously-skip-permissions');
    });

    it('approve-for-me with shell enables Bash for Claude', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "claude --print -p 'hi'",
            {
                agentId: 'claude',
                approvalPolicyId: 'approve-for-me',
                autoApprove: true,
                toolApprovalRules: { shell: true, network: false },
            },
        );
        expect(command).to.include('--allowed-tools');
        expect(command).to.include('Bash');
    });

    it('full-access bypasses Claude permissions', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "claude --print -p 'hi'",
            { agentId: 'claude', approvalPolicyId: 'full-access', autoApprove: true },
        );
        expect(command).to.include('--dangerously-skip-permissions');
    });

    it('approve-for-me uses workspace-write sandbox for Codex when shell is enabled', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "codex exec --json 'hi'",
            { agentId: 'codex', approvalPolicyId: 'approve-for-me', autoApprove: true },
        );
        expect(command).to.include('--sandbox workspace-write');
        expect(command).not.to.include('--dangerously-bypass-approvals-and-sandbox');
    });

    it('approve-for-me uses full-auto for Codex when shell is explicitly disabled', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "codex exec --json 'hi'",
            {
                agentId: 'codex',
                approvalPolicyId: 'approve-for-me',
                autoApprove: true,
                toolApprovalRules: { shell: false, network: false },
            },
        );
        expect(command).to.include('--full-auto');
        expect(command).not.to.include('--dangerously-bypass-approvals-and-sandbox');
    });

    it('request-approval keeps Codex interactive', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "codex exec --json 'hi'",
            { agentId: 'codex', approvalPolicyId: 'request-approval', autoApprove: false },
        );
        expect(command).not.to.include('--full-auto');
    });

    it('default approve-for-me does not use QAIQ stdio on headless runs', () => {
        expect(shouldUseQaiqStdioApprovals({
            agentId: 'qaiq',
            approvalPolicyId: 'approve-for-me',
            autoApprove: true,
        })).to.equal(false);
        expect(shouldUseQaiqStdioApprovals({
            agentId: 'qaiq',
            approvalPolicyId: 'request-approval',
            autoApprove: false,
        })).to.equal(true);
        expect(shouldUseInteractiveAgentApprovals({
            agentId: 'qaiq',
            approvalPolicyId: 'approve-for-me',
            autoApprove: true,
        })).to.equal(false);
    });

    it('approve-for-me with shell disabled omits Bash from the QAIQ tool allowlist', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "qaiq --print -p 'hi'",
            {
                agentId: 'qaiq',
                approvalPolicyId: 'approve-for-me',
                autoApprove: true,
                toolApprovalRules: { shell: false, network: false },
            },
        );
        expect(command).to.include('--tools Read,Write,Edit,Grep,Glob,NotebookEdit,TodoWrite,Agent');
        expect(command).not.to.include(',Bash');
        expect(shouldUseQaiqStdioApprovals({
            agentId: 'qaiq',
            approvalPolicyId: 'approve-for-me',
            autoApprove: true,
            toolApprovalRules: { shell: false, network: false },
        })).to.equal(false);
    });
});
