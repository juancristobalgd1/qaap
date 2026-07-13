// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildDestructiveCommandDenyMessage,
    findQaiqDestructiveCommandGuardDenial,
    isDestructiveShellCommand,
} from './qaap-agent-destructive-command-guard';

describe('qaap-agent-destructive-command-guard', () => {

    it('blocks force pushes and remote branch deletion', () => {
        const blocked = [
            'git push --force',
            'git push -f origin main',
            'git push --force-with-lease origin feature',
            'git push origin +main',
            'git push origin --delete feature-x',
            'git push origin :feature-x',
        ];
        for (const command of blocked) {
            expect(isDestructiveShellCommand(command), command).to.equal(true);
        }
    });

    it('blocks history and working-tree destruction', () => {
        const blocked = [
            'git reset --hard HEAD~3',
            'git reset --hard origin/main',
            'git clean -fd',
            'git clean --force',
            'git branch -D feature-x',
            'git branch --delete --force feature-x',
            'git filter-branch --tree-filter "rm -f secrets" HEAD',
            'git filter-repo --path secrets --invert-paths',
        ];
        for (const command of blocked) {
            expect(isDestructiveShellCommand(command), command).to.equal(true);
        }
    });

    it('blocks rm -rf reaching outside the workspace or wiping it', () => {
        const blocked = [
            'rm -rf /workspace/other-repo',
            'rm -rf /',
            'rm -rf ~/Documents',
            'rm -rf ..',
            'rm -rf ../sibling',
            'rm -rf .',
            'rm -rf *',
            'sudo rm -rf /var/tmp/x',
            'rm -fr $HOME/.config',
            'cd /tmp && rm -rf /etc/nginx',
        ];
        for (const command of blocked) {
            expect(isDestructiveShellCommand(command), command).to.equal(true);
        }
    });

    it('allows normal git usage and workspace-scoped rm', () => {
        const allowed = [
            'git push',
            'git push origin feature-x',
            'git push -u origin feature-x',
            'git push --follow-tags',
            'git reset HEAD~1',
            'git reset --soft HEAD~1',
            'git clean -n',
            'git branch -d merged-branch',
            'git branch feature-y',
            'rm -rf node_modules',
            'rm -rf dist build',
            'rm -rf ./coverage',
            'rm file.txt',
            'rm -r src/old-dir',
            'npm run build && rm -rf dist/tmp',
        ];
        for (const command of allowed) {
            expect(isDestructiveShellCommand(command), command).to.equal(false);
        }
    });

    it('blocks destructive payloads wrapped in a nested shell (one indirection level)', () => {
        const blocked = [
            "sh -c 'git push --force origin main'",
            'bash -lc "rm -rf ~/other"',
            "zsh -c 'git reset --hard HEAD~5'",
            'nohup sh -c "git clean -fd" &',
            `sh -c "bash -c 'git push --force'"`,
        ];
        for (const command of blocked) {
            expect(isDestructiveShellCommand(command), command).to.equal(true);
        }
    });

    it('allows benign nested shell payloads', () => {
        const allowed = [
            "sh -c 'npm run build'",
            'bash -lc "git status && npm test"',
            "sh -c 'rm -rf node_modules && npm install'",
        ];
        for (const command of allowed) {
            expect(isDestructiveShellCommand(command), command).to.equal(false);
        }
    });

    it('handles empty and undefined commands', () => {
        expect(isDestructiveShellCommand(undefined)).to.equal(false);
        expect(isDestructiveShellCommand('')).to.equal(false);
        expect(isDestructiveShellCommand('   ')).to.equal(false);
    });

    it('denies shell control requests running destructive commands, with actionable guidance', () => {
        const denial = findQaiqDestructiveCommandGuardDenial({
            requestId: 'r1',
            toolName: 'Bash',
            toolInput: { command: 'git push --force origin main' },
        });
        expect(denial).to.equal(buildDestructiveCommandDenyMessage());
        expect(denial).to.contain('explicit request');
    });

    it('ignores non-shell tools and safe shell commands', () => {
        expect(findQaiqDestructiveCommandGuardDenial({
            requestId: 'r2',
            toolName: 'Read',
            toolInput: { command: 'git push --force' },
        })).to.equal(undefined);
        expect(findQaiqDestructiveCommandGuardDenial({
            requestId: 'r3',
            toolName: 'Bash',
            toolInput: { command: 'git status' },
        })).to.equal(undefined);
    });
});
