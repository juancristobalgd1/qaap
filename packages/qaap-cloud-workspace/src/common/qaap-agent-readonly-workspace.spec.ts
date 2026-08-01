// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { applyAgentApprovalPolicyToCommand } from './qaap-agent-approval-flags';
import {
    canEnforceReadOnlyWorkspace,
    formatReadOnlyFlagsForAgent,
    resolveAgentReadOnlyEnforcement,
} from './qaap-agent-readonly-workspace';
import { resolveQaiqCoreToolNames } from './qaap-qaiq-tool-policy';

/** The templates the runner actually builds, before approval flags are applied. */
const QAIQ_TEMPLATE = "qaiq --print --output-format stream-json --verbose --dangerously-skip-permissions -p 'judge this'";
const CLAUDE_TEMPLATE = "claude --print --output-format stream-json --verbose -p 'judge this'";
const CODEX_TEMPLATE = "codex exec --json 'judge this'";

describe('qaap-agent-readonly-workspace enforcement table', () => {

    it('classifies each backend by what it can actually enforce', () => {
        expect(resolveAgentReadOnlyEnforcement('codex')).to.equal('sandbox');
        expect(resolveAgentReadOnlyEnforcement('claude')).to.equal('tool-deny');
        expect(resolveAgentReadOnlyEnforcement('qaiq')).to.equal('tool-deny');
        expect(resolveAgentReadOnlyEnforcement('openclaude')).to.equal('tool-deny');
    });

    it('reports no enforcement for backends with no verified mechanism', () => {
        for (const agentId of ['grok', 'opencode', 'copilot', 'qwen', 'goose', 'cursor', 'shell', undefined]) {
            expect(resolveAgentReadOnlyEnforcement(agentId), agentId ?? 'undefined').to.equal('none');
            expect(canEnforceReadOnlyWorkspace(agentId), agentId ?? 'undefined').to.equal(false);
            expect(formatReadOnlyFlagsForAgent(agentId), agentId ?? 'undefined').to.equal(undefined);
        }
    });
});

describe('qaap-agent-readonly-workspace command flags', () => {

    it('launches QAIQ without any workspace-mutating tool', () => {
        const command = applyAgentApprovalPolicyToCommand(QAIQ_TEMPLATE, {
            agentId: 'qaiq',
            readOnlyWorkspace: true,
        });
        const tools = /--tools\s+(\S+)/.exec(command)?.[1].split(',') ?? [];
        expect(tools).to.have.members(['Read', 'Grep', 'Glob', 'TodoWrite', 'WebFetch', 'WebSearch']);
        // The tools that produced the observed violation must not be reachable at all.
        for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Bash', 'Agent']) {
            expect(tools, tool).to.not.include(tool);
        }
    });

    it('also lists the write tools as denied, so the allowlist has a backstop', () => {
        const command = applyAgentApprovalPolicyToCommand(QAIQ_TEMPLATE, {
            agentId: 'qaiq',
            readOnlyWorkspace: true,
        });
        const denied = /--disallowed-tools\s+(\S+)/.exec(command)?.[1].split(',') ?? [];
        expect(denied).to.include.members(['Write', 'Edit', 'NotebookEdit', 'Bash', 'Agent']);
        // The pre-existing headless blocklist is preserved, not replaced.
        expect(denied).to.include.members(['Task', 'Skill']);
    });

    it('denies Claude the write tools and the shell that would bypass them', () => {
        const command = applyAgentApprovalPolicyToCommand(CLAUDE_TEMPLATE, {
            agentId: 'claude',
            readOnlyWorkspace: true,
        });
        expect(command).to.include('--disallowed-tools Edit Write MultiEdit NotebookEdit Bash');
        expect(command).to.include('--allowed-tools Read Grep Glob WebFetch WebSearch');
        expect(command).to.not.include('--dangerously-skip-permissions');
        expect(command).to.not.include('acceptEdits');
    });

    it('puts Codex under its OS-level read-only sandbox', () => {
        const command = applyAgentApprovalPolicyToCommand(CODEX_TEMPLATE, {
            agentId: 'codex',
            readOnlyWorkspace: true,
        });
        expect(command).to.include('--sandbox read-only');
        // Without this the sandboxed run stalls waiting for an approval nobody can give.
        expect(command).to.include('--ask-for-approval never');
    });

    it('strips the template auto-approval flags instead of leaving them beside the restriction', () => {
        // A skip-permissions flag surviving next to the read-only flags is the whole failure mode.
        expect(applyAgentApprovalPolicyToCommand(QAIQ_TEMPLATE, { agentId: 'qaiq', readOnlyWorkspace: true }))
            .to.not.match(/--dangerously-skip-permissions[\s\S]*--dangerously-skip-permissions/);
        expect(applyAgentApprovalPolicyToCommand("codex exec --json --full-auto 'x'", { agentId: 'codex', readOnlyWorkspace: true }))
            .to.not.include('--full-auto');
        expect(applyAgentApprovalPolicyToCommand(
            "claude --print --dangerously-skip-permissions -p 'x'",
            { agentId: 'claude', readOnlyWorkspace: true },
        )).to.not.include('--dangerously-skip-permissions');
    });

    it('overrides the approval preset — read-only is not a thing a policy can approve away', () => {
        const command = applyAgentApprovalPolicyToCommand(CODEX_TEMPLATE, {
            agentId: 'codex',
            approvalPolicyId: 'full-access',
            autoApprove: true,
            toolApprovalRules: { shell: true, network: true },
            readOnlyWorkspace: true,
        });
        expect(command).to.include('--sandbox read-only');
        expect(command).to.not.include('--dangerously-bypass-approvals-and-sandbox');
    });

    it('leaves a writer turn exactly as the approval policy built it', () => {
        const writer = applyAgentApprovalPolicyToCommand(QAIQ_TEMPLATE, {
            agentId: 'qaiq',
            approvalPolicyId: 'approve-for-me',
            autoApprove: true,
        });
        expect(writer).to.include('--permission-mode default');
        expect(writer).to.not.include('--dangerously-skip-permissions');
        expect(writer).to.include('--allowed-tools Read,Write,Edit,Grep,Glob,NotebookEdit,TodoWrite,WebFetch,WebSearch');
        const tools = /--tools\s+(\S+)/.exec(writer)?.[1].split(',') ?? [];
        expect(tools).to.include.members(['Write', 'Edit', 'Bash', 'NotebookEdit']);
    });

    it('returns an unrestrictable backend\'s command untouched rather than faking a restriction', () => {
        const command = applyAgentApprovalPolicyToCommand("grok --always-approve -p 'x'", {
            agentId: 'grok',
            readOnlyWorkspace: true,
        });
        expect(command).to.equal("grok --always-approve -p 'x'");
    });
});

describe('resolveQaiqCoreToolNames write scope', () => {

    it('keeps the full coding set by default', () => {
        expect(resolveQaiqCoreToolNames()).to.include.members(['Write', 'Edit', 'Bash', 'NotebookEdit', 'Agent']);
    });

    it('drops mutating tools and delegation when write is off', () => {
        const tools = resolveQaiqCoreToolNames({ shell: false, write: false });
        expect(tools).to.deep.equal(['Read', 'Grep', 'Glob', 'TodoWrite', 'WebFetch', 'WebSearch']);
    });

    it('keeps the shell scope independent of the write scope', () => {
        expect(resolveQaiqCoreToolNames({ write: false })).to.include('Bash');
        expect(resolveQaiqCoreToolNames({ shell: false })).to.include('Write');
    });
});
