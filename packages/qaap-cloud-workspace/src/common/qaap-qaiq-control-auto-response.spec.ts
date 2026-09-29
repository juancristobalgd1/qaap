// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    commandMayChangeShellCwd,
    resolveQaiqControlRequestAutoAction,
    resolveQaiqControlRequestAutoDecision,
    type QaapQaiqControlAutoOptions,
} from './qaap-qaiq-control-auto-response';
import type { QaapQaiqPendingControlRequest } from './qaap-qaiq-stdio-approvals';

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
    describe('read-only shell auto-approval', () => {
        const bash = (command: string): QaapQaiqPendingControlRequest => ({ requestId: 'req-ro', toolName: 'Bash', toolInput: { command } });
        /** Preference on, and both runtime checks pass. */
        const enabled: QaapQaiqControlAutoOptions = {
            autoApproveReadOnlyShell: true,
            checkGitExecConfig: () => undefined,
            checkPathsInsideCwd: () => undefined,
        };

        it('auto-approves a read-only command under request-approval and records the reason', () => {
            const decision = resolveQaiqControlRequestAutoDecision(approveForMeShellCommand, false, bash('git status && ls -la'), enabled);
            expect(decision.action).to.equal('allow');
            expect(decision.reason).to.equal('read-only-shell');
        });

        it('is off unless the preference is explicitly true', () => {
            const withoutPreference = { ...enabled, autoApproveReadOnlyShell: undefined };
            expect(resolveQaiqControlRequestAutoAction(approveForMeShellCommand, false, bash('ls'), withoutPreference)).to.equal('queue');
            expect(resolveQaiqControlRequestAutoAction(approveForMeShellCommand, false, bash('ls'), { ...enabled, autoApproveReadOnlyShell: false }))
                .to.equal('queue');
        });

        it('falls back to manual approval when the git config could run a program', () => {
            const decision = resolveQaiqControlRequestAutoDecision(approveForMeShellCommand, false, bash('git diff'), {
                ...enabled,
                checkGitExecConfig: () => 'git config diff.external can run a program',
            });
            expect(decision.action).to.equal('queue');
            expect(decision.reason).to.equal(undefined);
            expect(decision.readOnlyBlockedReason).to.equal('git config diff.external can run a program');
        });

        it('does not auto-approve git commands when no git config checker is supplied', () => {
            const withoutGitCheck = { ...enabled, checkGitExecConfig: undefined };
            const decision = resolveQaiqControlRequestAutoDecision(approveForMeShellCommand, false, bash('git log -1'), withoutGitCheck);
            expect(decision.action).to.equal('queue');
            expect(decision.readOnlyBlockedReason).to.equal('git config not verified');
        });

        it('treats a throwing git config checker as unverified', () => {
            const decision = resolveQaiqControlRequestAutoDecision(approveForMeShellCommand, false, bash('git status'), {
                ...enabled,
                checkGitExecConfig: () => {
                    throw new Error('spawn failed');
                },
            });
            expect(decision.action).to.equal('queue');
        });

        it('only consults the git checker for commands that use git', () => {
            let calls = 0;
            const decision = resolveQaiqControlRequestAutoDecision(approveForMeShellCommand, false, bash('ls src'), {
                ...enabled,
                checkGitExecConfig: () => {
                    calls++;
                    return 'risky';
                },
            });
            expect(decision.action).to.equal('allow');
            expect(calls).to.equal(0);
        });

        it('passes the path arguments (with cd applied) to the symlink check and honours its veto', () => {
            let seen: readonly string[] = [];
            const decision = resolveQaiqControlRequestAutoDecision(approveForMeShellCommand, false, bash('cd src && cat a.txt < in.txt'), {
                ...enabled,
                checkPathsInsideCwd: paths => {
                    seen = paths;
                    return 'path leaves the working directory: src/a.txt';
                },
            });
            expect([...seen].sort()).to.deep.equal(['in.txt', 'src', 'src/a.txt']);
            expect(decision.action).to.equal('queue');
            expect(decision.readOnlyBlockedReason).to.contain('leaves the working directory');
        });

        it('does not auto-approve path arguments when no path checker is supplied', () => {
            const withoutPathCheck = { ...enabled, checkPathsInsideCwd: undefined };
            const decision = resolveQaiqControlRequestAutoDecision(approveForMeShellCommand, false, bash('cat a.txt'), withoutPathCheck);
            expect(decision.action).to.equal('queue');
            expect(decision.readOnlyBlockedReason).to.equal('paths not verified');
            expect(resolveQaiqControlRequestAutoAction(approveForMeShellCommand, false, bash('pwd'), withoutPathCheck)).to.equal('allow');
        });

        it('allows absolute paths inside the task cwd but queues paths outside it or sensitive files', () => {
            const options = { ...enabled, cwd: '/home/alice/project' };
            expect(resolveQaiqControlRequestAutoAction(approveForMeShellCommand, false, bash('cat /home/alice/project/a.txt'), options))
                .to.equal('allow');
            expect(resolveQaiqControlRequestAutoAction(approveForMeShellCommand, false, bash('cat /etc/passwd'), options))
                .to.equal('queue');
            expect(resolveQaiqControlRequestAutoAction(approveForMeShellCommand, false, bash('cat .env'), options))
                .to.equal('queue');
        });

        it('still queues non-read-only shell commands under request-approval', () => {
            const decision = resolveQaiqControlRequestAutoDecision(approveForMeShellCommand, false, bash('echo x > out.txt'), enabled);
            expect(decision.action).to.equal('queue');
            expect(decision.reason).to.equal(undefined);
        });

        it('auto-approves read-only commands that approve-for-me would otherwise queue', () => {
            expect(resolveQaiqControlRequestAutoAction(approveForMeCommand, true, bash('cat package.json | head -5'), enabled)).to.equal('allow');
            expect(resolveQaiqControlRequestAutoAction(approveForMeCommand, true, bash('npm install'), enabled)).to.equal('queue');
        });

        it('never overrides a core --tools allowlist that excludes the shell tool', () => {
            const noShell = 'qaiq --permission-mode default --tools Read,Grep,Glob --allowed-tools Read,Grep,Glob';
            expect(resolveQaiqControlRequestAutoAction(noShell, true, bash('ls'), enabled)).to.equal('deny');
        });

        it('ignores non-shell tools', () => {
            const decision = resolveQaiqControlRequestAutoDecision(approveForMeCommand, false, {
                requestId: 'req-web', toolName: 'WebFetch', toolInput: { command: 'ls' },
            }, enabled);
            expect(decision.action).to.equal('queue');
            expect(decision.reason).to.equal(undefined);
        });

        it('detects commands that may move the persistent shell cwd', () => {
            expect(commandMayChangeShellCwd('cd src && ls')).to.equal(true);
            expect(commandMayChangeShellCwd('ls; pushd x')).to.equal(true);
            expect(commandMayChangeShellCwd('popd')).to.equal(true);
            expect(commandMayChangeShellCwd('cat abcd.txt')).to.equal(false);
            expect(commandMayChangeShellCwd('grep -r cdn src')).to.equal(false);
            expect(commandMayChangeShellCwd(undefined)).to.equal(false);
        });
    });
});
