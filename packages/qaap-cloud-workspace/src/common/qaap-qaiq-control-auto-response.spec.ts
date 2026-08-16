// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveQaiqControlRequestAutoAction } from './qaap-qaiq-control-auto-response';

describe('qaap-qaiq-control-auto-response', () => {
    const approveForMeCommand = 'qaiq --permission-mode default --allowed-tools Read,Grep,Glob,LS,Edit,Write,NotebookEdit';
    const approveForMeShellCommand = 'qaiq --permission-mode default --allowed-tools Read,Grep,Glob,LS,Edit,Write,NotebookEdit,Bash';
    const controlledApproveForMeCommand = 'qaiq --permission-mode default '
        + '--tools Read,Write,Edit,Bash,Grep,Glob,NotebookEdit,TodoWrite,Agent '
        + '--allowed-tools Read,Write,Edit,Grep,Glob,NotebookEdit,TodoWrite';

    it('queues manual approvals when auto-approve is off', () => {
        expect(resolveQaiqControlRequestAutoAction(approveForMeCommand, false, {
            requestId: 'req-1',
            toolName: 'Read',
        })).to.equal('queue');
    });

    it('denies dev-server commands even under request-approval — approval cannot make them work', () => {
        expect(resolveQaiqControlRequestAutoAction(approveForMeShellCommand, false, {
            requestId: 'req-ds',
            toolName: 'Bash',
            toolInput: { command: 'npm run dev' },
        })).to.equal('deny');
    });

    it('queues destructive commands under request-approval — explicit human approval is the required consent', () => {
        expect(resolveQaiqControlRequestAutoAction(approveForMeShellCommand, false, {
            requestId: 'req-dc',
            toolName: 'Bash',
            toolInput: { command: 'git reset --hard HEAD~1' },
        })).to.equal('queue');
    });

    it('queues WebSearch under approve-for-me allowed-tools so the user can grant it', () => {
        expect(resolveQaiqControlRequestAutoAction(approveForMeShellCommand, true, {
            requestId: 'req-1',
            toolName: 'WebSearch',
        })).to.equal('queue');
    });

    it('allows Bash when shell scope is enabled in approve-for-me allowed-tools', () => {
        expect(resolveQaiqControlRequestAutoAction(approveForMeShellCommand, true, {
            requestId: 'req-1',
            toolName: 'Bash',
        })).to.equal('allow');
    });

    it('auto-allows safe Bash after Qaap guards when Bash is controlled through stdio', () => {
        expect(resolveQaiqControlRequestAutoAction(controlledApproveForMeCommand, true, {
            requestId: 'req-controlled-bash',
            toolName: 'Bash',
            toolInput: { command: 'npm test' },
        })).to.equal('allow');
        expect(resolveQaiqControlRequestAutoAction(controlledApproveForMeCommand, true, {
            requestId: 'req-controlled-kill',
            toolName: 'Bash',
            toolInput: { command: 'pkill -f vite' },
        })).to.equal('queue');
    });

    it('queues destructive shell under approve-for-me for explicit Allow/Deny', () => {
        expect(resolveQaiqControlRequestAutoAction(controlledApproveForMeCommand, true, {
            requestId: 'req-destructive',
            toolName: 'Bash',
            toolInput: { command: 'git reset --hard HEAD~1' },
        })).to.equal('queue');
    });

    it('queues Bash when shell scope is disabled in approve-for-me allowed-tools', () => {
        expect(resolveQaiqControlRequestAutoAction(approveForMeCommand, true, {
            requestId: 'req-1',
            toolName: 'Bash',
        })).to.equal('queue');
    });

    it('queues shell/network tools when no allowed-tools list is present', () => {
        expect(resolveQaiqControlRequestAutoAction('qaiq --permission-mode default', true, {
            requestId: 'req-1',
            toolName: 'WebFetch',
        })).to.equal('queue');
    });

    it('allows Read under approve-for-me allowed-tools', () => {
        expect(resolveQaiqControlRequestAutoAction(approveForMeCommand, true, {
            requestId: 'req-1',
            toolName: 'Read',
        })).to.equal('allow');
    });

    it('allows everything in bypassPermissions mode', () => {
        expect(resolveQaiqControlRequestAutoAction('qaiq --permission-mode bypassPermissions', true, {
            requestId: 'req-1',
            toolName: 'WebSearch',
        })).to.equal('allow');
    });

    it('denies destructive shell commands in bypassPermissions / full-access mode', () => {
        expect(resolveQaiqControlRequestAutoAction('qaiq --permission-mode bypassPermissions', true, {
            requestId: 'req-1',
            toolName: 'Bash',
            toolInput: { command: 'git push --force origin main' },
        })).to.equal('deny');
    });

    it('queues destructive shell under approve-for-me allowed-tools for Allow/Deny', () => {
        expect(resolveQaiqControlRequestAutoAction(approveForMeShellCommand, true, {
            requestId: 'req-2',
            toolName: 'Bash',
            toolInput: { command: 'rm -rf ~/other-project' },
        })).to.equal('queue');
    });

    it('does not deny safe shell commands via the destructive guard', () => {
        expect(resolveQaiqControlRequestAutoAction(approveForMeShellCommand, true, {
            requestId: 'req-3',
            toolName: 'Bash',
            toolInput: { command: 'git push -u origin feature-x && rm -rf node_modules' },
        })).to.equal('allow');
    });

    it('denies Agent with non-verification subagent_type, allows verification', () => {
        // Agent with web-dev is denied
        expect(resolveQaiqControlRequestAutoAction(approveForMeCommand, true, {
            requestId: 'req-1',
            toolName: 'Agent',
            toolInput: { subagent_type: 'web-dev' },
        })).to.equal('deny');
        // Agent with verification is allowed (not in blocked list, in core tools)
        expect(resolveQaiqControlRequestAutoAction('qaiq --permission-mode bypassPermissions', true, {
            requestId: 'req-2',
            toolName: 'Agent',
            toolInput: { subagent_type: 'verification' },
        })).to.equal('allow');
        expect(resolveQaiqControlRequestAutoAction(controlledApproveForMeCommand, true, {
            requestId: 'req-2-controlled',
            toolName: 'Agent',
            toolInput: { subagent_type: 'verification' },
        })).to.equal('allow');
        // Task (legacy Agent name) is still blocked
        expect(resolveQaiqControlRequestAutoAction('qaiq --permission-mode default', true, {
            requestId: 'req-3',
            toolName: 'Task',
        })).to.equal('deny');
    });

    it('denies Skill lookups even in bypassPermissions mode', () => {
        expect(resolveQaiqControlRequestAutoAction('qaiq --permission-mode bypassPermissions', true, {
            requestId: 'req-1',
            toolName: 'Skill',
            toolInput: { skill: 'claude-code-guide' },
        })).to.equal('deny');
    });

    it('denies AskUserQuestion even in bypassPermissions mode', () => {
        expect(resolveQaiqControlRequestAutoAction('qaiq --permission-mode bypassPermissions', true, {
            requestId: 'req-1',
            toolName: 'AskUserQuestion',
            toolInput: { questions: 'Which framework?' },
        })).to.equal('deny');
    });

    it('denies Theia Coder bridge tools even in bypassPermissions mode', () => {
        expect(resolveQaiqControlRequestAutoAction('qaiq --permission-mode bypassPermissions', true, {
            requestId: 'req-1',
            toolName: 'qaap_bootstrap_run_dev',
        })).to.equal('deny');
        expect(resolveQaiqControlRequestAutoAction('qaiq --permission-mode bypassPermissions', true, {
            requestId: 'req-2',
            toolName: 'getWorkspaceFileList',
        })).to.equal('deny');
    });

    it('denies tools outside the --tools allowlist when present', () => {
        const command = 'qaiq --permission-mode default --tools Read,Write,Edit,Bash,Grep,Glob';
        // Agent is not in this custom --tools list, so it's denied
        expect(resolveQaiqControlRequestAutoAction(command, true, {
            requestId: 'req-1',
            toolName: 'Agent',
            toolInput: { subagent_type: 'verification' },
        })).to.equal('deny');
        expect(resolveQaiqControlRequestAutoAction(command, true, {
            requestId: 'req-2',
            toolName: 'TodoWrite',
        })).to.equal('deny');
    });

    it('denies long-lived dev-server shell commands even with auto-approve', () => {
        expect(resolveQaiqControlRequestAutoAction('qaiq --permission-mode bypassPermissions', true, {
            requestId: 'req-1',
            toolName: 'Bash',
            toolInput: { command: 'pnpm dev' },
        })).to.equal('deny');
    });
});
