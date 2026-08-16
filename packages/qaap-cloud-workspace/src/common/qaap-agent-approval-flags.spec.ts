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

    it('approve-for-me keeps QAIQ on stdio-controlled permissions', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "qaiq --print -p 'hi'",
            { agentId: 'qaiq', approvalPolicyId: 'approve-for-me', autoApprove: true },
        );
        expect(command).to.include('--permission-mode default');
        expect(command).not.to.include('--dangerously-skip-permissions');
        expect(command).to.include('--tools Read,Write,Edit,Bash,Grep,Glob,NotebookEdit,TodoWrite,Agent');
        expect(command).to.include('--disallowed-tools');
        expect(command).to.include('Task');
        expect(command).to.include('Skill');
        expect(command).to.include('--allowed-tools');
        expect(command).not.to.match(/--allowed-tools\s+[^\s]*\bBash\b/);
    });

    it('approve-for-me strips template acceptEdits before injecting controlled permissions', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "qaiq --permission-mode acceptEdits --print -p 'hi'",
            { agentId: 'qaiq', approvalPolicyId: 'approve-for-me', autoApprove: true },
        );
        expect(command).to.include('--permission-mode default');
        expect(command).not.to.include('--dangerously-skip-permissions');
        expect(command).not.to.include('acceptEdits');
    });

    it('approve-for-me blocks QAIQ headless tools under controlled permissions', () => {
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

    it('default approve-for-me uses QAIQ stdio without stripping CLI approval flags', () => {
        // CLI "interactive" (stripNonInteractiveApprovalFlags) is only for request-approval.
        // Approve-for-me keeps stdio control flags; the Allow/Deny card is mounted by the
        // mobile-shell usesInteractiveAgentApprovals helper when control requests are queued.
        expect(shouldUseQaiqStdioApprovals({
            agentId: 'qaiq',
            approvalPolicyId: 'approve-for-me',
            autoApprove: true,
        })).to.equal(true);
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
        expect(shouldUseInteractiveAgentApprovals({
            agentId: 'qaiq',
            approvalPolicyId: 'request-approval',
            autoApprove: false,
        })).to.equal(true);
    });

    it('request-approval strips OpenCode YOLO so the policy is not silently full-access', () => {
        const command = applyAgentApprovalPolicyToCommand(
            "opencode run --format json --dangerously-skip-permissions 'hi'",
            { agentId: 'opencode', approvalPolicyId: 'request-approval', autoApprove: false },
        );
        expect(command).not.to.include('--dangerously-skip-permissions');
        expect(command).not.to.include('--auto');
        expect(command).to.include('opencode run');
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
        })).to.equal(true);
    });

    describe('dispatch is by agentId, not by scanning the whole command for another agent\'s name', () => {

        it('a real codex command whose prompt mentions "claude" still gets Codex flags, not Claude\'s', () => {
            // Regression: the default qaap workflow prompt tells subagents never to call
            // `Agent` with subagent_type 'claude --permission-mode default --allowed-tools ...' —
            // that literal text used to make an unanchored /\bclaude\b/ regex match the whole
            // command and misroute it to applyClaudeApprovalFlags, which no-ops (no `claude`
            // executable present at the start of the command) and leaves a real Codex run with
            // no sandbox flags at all, i.e. Codex falls back to its default read-only sandbox
            // in production.
            const command = "codex exec --json -m gpt-5.6-sol 'Never call Agent with any other subagent_type "
                + '(web-dev, react-debug, explore, claude --permission-mode default --allowed-tools Edit Write '
                + "NotebookEdit Bash-command). Do the task.'";
            const result = applyAgentApprovalPolicyToCommand(command, { agentId: 'codex', autoApprove: true });
            // Codex-specific flags must be injected right after the `codex` executable.
            expect(result).to.match(/^codex --sandbox workspace-write --ask-for-approval untrusted\s+exec\s/);
            expect(result).to.include('--sandbox workspace-write');
            expect(result).to.include('--ask-for-approval untrusted');
            // The prompt text is left untouched — it still literally contains the word "claude",
            // which is exactly why the unanchored regex used to misfire.
            expect(result).to.include('claude --permission-mode default --allowed-tools Edit Write NotebookEdit Bash-command');
        });

        it('a real claude command whose prompt mentions "codex" still gets Claude flags, not Codex\'s', () => {
            const command = "claude --print -p 'This task may delegate work to codex when appropriate.'";
            const result = applyAgentApprovalPolicyToCommand(command, { agentId: 'claude', autoApprove: true });
            expect(result).to.include('--allowed-tools');
            expect(result).to.include('Bash');
            expect(result).not.to.include('--sandbox');
            expect(result).not.to.include('--ask-for-approval');
        });

        it('falls back to command-text sniffing only when agentId is not supplied (legacy tasks)', () => {
            const command = "codex exec --json 'hi'";
            const result = applyAgentApprovalPolicyToCommand(command, { agentId: undefined, autoApprove: true });
            expect(result).to.include('--sandbox workspace-write');
        });

        it('the fallback sniffing is anchored to the start of the command, not the prompt body', () => {
            // Same idea as the codex/claude case above, but with no agentId at all: the command
            // itself still begins with `codex`, so the fallback inference must not be fooled by
            // the word "claude" appearing later in the quoted prompt.
            const command = "codex exec --json 'please act like claude and be careful'";
            const result = applyAgentApprovalPolicyToCommand(command, { agentId: undefined, autoApprove: true });
            expect(result).to.include('--sandbox workspace-write');
            expect(result).not.to.include('--permission-mode');
        });

        it('opencode and qaiq dispatch remain intact when agentId is known', () => {
            const opencode = applyAgentApprovalPolicyToCommand(
                "opencode run 'mentions claude and codex in passing'",
                { agentId: 'opencode', autoApprove: true },
            );
            expect(opencode).to.include('--dangerously-skip-permissions');

            const qaiq = applyAgentApprovalPolicyToCommand(
                "qaiq --print -p 'mentions claude and codex in passing'",
                { agentId: 'qaiq', approvalPolicyId: 'approve-for-me', autoApprove: true },
            );
            expect(qaiq).to.include('--permission-mode default');
            expect(qaiq).not.to.include('--dangerously-skip-permissions');
            expect(qaiq).to.include('--tools');
        });

        it('custom QAIQ provider ids inherit the QAIQ safety policy from their executable', () => {
            const result = applyAgentApprovalPolicyToCommand(
                'OPENAI_API_KEY=$OPENROUTER_API_KEY OPENAI_BASE_URL=https://openrouter.ai/api/v1 '
                    + "qaiq --print --dangerously-skip-permissions --provider openai --model free-model 'hi'",
                { agentId: 'qaiq-openrouter-free', approvalPolicyId: 'approve-for-me', autoApprove: true },
            );
            expect(result).to.include('--permission-mode default');
            expect(result).not.to.include('--dangerously-skip-permissions');
            expect(result).to.include('--tools Read,Write,Edit,Bash,Grep,Glob,NotebookEdit,TodoWrite,Agent');
            expect(result).not.to.match(/--allowed-tools\s+[^\s]*\bBash\b/);
        });

        it('explicit shell tasks remain raw even when their command starts with an agent executable', () => {
            const result = applyAgentApprovalPolicyToCommand(
                "qaiq --print --dangerously-skip-permissions 'diagnostic'",
                { agentId: 'shell', approvalPolicyId: 'approve-for-me', autoApprove: true },
            );
            expect(result).to.include('--dangerously-skip-permissions');
            expect(result).not.to.include('--permission-mode default');
        });
    });
});
