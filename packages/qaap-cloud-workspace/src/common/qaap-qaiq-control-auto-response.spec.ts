// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveQaiqControlRequestAutoAction } from './qaap-qaiq-control-auto-response';

describe('qaap-qaiq-control-auto-response', () => {
    const approveForMeCommand = 'qaiq --permission-mode default --allowed-tools Read,Grep,Glob,LS,Edit,Write,NotebookEdit';
    const approveForMeShellCommand = 'qaiq --permission-mode default --allowed-tools Read,Grep,Glob,LS,Edit,Write,NotebookEdit,Bash';

    it('queues manual approvals when auto-approve is off', () => {
        expect(resolveQaiqControlRequestAutoAction(approveForMeCommand, false, {
            requestId: 'req-1',
            toolName: 'Read',
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
