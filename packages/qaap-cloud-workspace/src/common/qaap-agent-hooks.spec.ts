// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QAAP_AGENT_HOOK_DEFAULT_TIMEOUT_SEC,
    QAAP_AGENT_HOOK_MAX_TIMEOUT_SEC,
    flattenQaapAgentHookDeclaration,
    interpretQaapAgentHookResult,
    isQaapAgentHookDeclarationEmpty,
    matchesQaapAgentHookMatcher,
    normalizeQaapAgentHookDeclaration,
    parseQaapAgentHooksConfig,
    selectQaapAgentHookCommands,
} from './qaap-agent-hooks';

describe('qaap-agent-hooks', () => {

    describe('parseQaapAgentHooksConfig', () => {
        it('parses the Claude Code settings shape', () => {
            const { declaration, errors } = parseQaapAgentHooksConfig({
                hooks: {
                    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check.sh', timeout: 30 }] }],
                    Stop: [{ hooks: [{ type: 'command', command: 'notify.sh' }] }],
                },
            });
            expect(errors).to.deep.equal([]);
            expect(declaration.PreToolUse).to.deep.equal([{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check.sh', timeoutSec: 30 }] }]);
            expect(declaration.Stop![0].hooks[0].timeoutSec).to.equal(QAAP_AGENT_HOOK_DEFAULT_TIMEOUT_SEC);
        });

        it('accepts the bare event map and clamps timeouts', () => {
            const { declaration } = parseQaapAgentHooksConfig({
                UserPromptSubmit: [{ hooks: [{ command: 'a', timeout: 99999 }, { command: 'b', timeout: 0 }] }],
            });
            expect(declaration.UserPromptSubmit![0].hooks.map(hook => hook.timeoutSec)).to.deep.equal([QAAP_AGENT_HOOK_MAX_TIMEOUT_SEC, 1]);
        });

        it('reports and drops unknown events, invalid entries and bad regexes', () => {
            const { declaration, errors } = parseQaapAgentHooksConfig({
                hooks: {
                    Notification: [{ hooks: [{ command: 'x' }] }],
                    PreToolUse: [
                        { matcher: '(', hooks: [{ command: 'x' }] },
                        { matcher: 'Edit', hooks: [{ type: 'prompt', command: 'x' }, { command: '' }, { command: 'ok' }] },
                    ],
                    Stop: 'nope',
                },
            });
            expect(errors).to.have.length(5);
            expect(declaration.PreToolUse).to.deep.equal([{ matcher: 'Edit', hooks: [{ type: 'command', command: 'ok', timeoutSec: 60 }] }]);
            expect(declaration.Stop).to.equal(undefined);
        });

        it('rejects non-object input and treats undefined as empty', () => {
            expect(parseQaapAgentHooksConfig([]).errors).to.have.length(1);
            expect(parseQaapAgentHooksConfig({ hooks: [] }).errors).to.have.length(1);
            expect(isQaapAgentHookDeclarationEmpty(parseQaapAgentHooksConfig(undefined).declaration)).to.equal(true);
        });
    });

    describe('matchers', () => {
        it('matches everything for empty or *', () => {
            expect(matchesQaapAgentHookMatcher(undefined, 'Bash')).to.equal(true);
            expect(matchesQaapAgentHookMatcher('*', undefined)).to.equal(true);
        });

        it('matches pipe lists exactly and other patterns as regex', () => {
            expect(matchesQaapAgentHookMatcher('Edit|Write', 'Write')).to.equal(true);
            expect(matchesQaapAgentHookMatcher('Edit|Write', 'MultiEdit')).to.equal(false);
            expect(matchesQaapAgentHookMatcher('mcp__.*', 'mcp__github__create_issue')).to.equal(true);
            expect(matchesQaapAgentHookMatcher('^Bash$', 'BashOutput')).to.equal(false);
            expect(matchesQaapAgentHookMatcher('Bash', undefined)).to.equal(false);
        });

        it('selects matching commands per event, deduplicated, ignoring matchers for UserPromptSubmit', () => {
            const { declaration } = parseQaapAgentHooksConfig({
                hooks: {
                    PreToolUse: [
                        { matcher: 'Bash', hooks: [{ command: 'a' }] },
                        { matcher: 'Edit', hooks: [{ command: 'b' }] },
                        { hooks: [{ command: 'a' }, { command: 'c' }] },
                    ],
                    UserPromptSubmit: [{ matcher: 'Bash', hooks: [{ command: 'p' }] }],
                },
            });
            expect(selectQaapAgentHookCommands(declaration, 'PreToolUse', 'Bash').map(hook => hook.command)).to.deep.equal(['a', 'c']);
            expect(selectQaapAgentHookCommands(declaration, 'PreToolUse', 'Edit').map(hook => hook.command)).to.deep.equal(['b', 'a', 'c']);
            expect(selectQaapAgentHookCommands(declaration, 'UserPromptSubmit').map(hook => hook.command)).to.deep.equal(['p']);
            expect(selectQaapAgentHookCommands(declaration, 'Stop')).to.deep.equal([]);
        });

        it('flattens for review listings', () => {
            const { declaration } = parseQaapAgentHooksConfig({ hooks: { Stop: [{ hooks: [{ command: 's' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'b' }] }] } });
            expect(flattenQaapAgentHookDeclaration(declaration)).to.deep.equal([
                { event: 'PreToolUse', matcher: 'Bash', command: 'b', timeoutSec: 60 },
                { event: 'Stop', command: 's', timeoutSec: 60 },
            ]);
        });
    });

    describe('normalizeQaapAgentHookDeclaration', () => {
        it('ignores formatting, key order and dropped invalid entries', () => {
            const a = parseQaapAgentHooksConfig({ hooks: { Stop: [{ hooks: [{ command: 's', type: 'command' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'b' }] }] } });
            const b = parseQaapAgentHooksConfig({ PreToolUse: [{ hooks: [{ command: 'b' }], matcher: 'Bash' }], Stop: [{ hooks: [{ type: 'command', command: 's' }, { command: '' }] }] });
            expect(normalizeQaapAgentHookDeclaration(a.declaration)).to.equal(normalizeQaapAgentHookDeclaration(b.declaration));
        });

        it('changes with commands, matchers and timeouts', () => {
            const base = normalizeQaapAgentHookDeclaration(parseQaapAgentHooksConfig({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'b' }] }] }).declaration);
            for (const variant of [
                { PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'b2' }] }] },
                { PreToolUse: [{ matcher: 'Edit', hooks: [{ command: 'b' }] }] },
                { PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'b', timeout: 5 }] }] },
                { PostToolUse: [{ matcher: 'Bash', hooks: [{ command: 'b' }] }] },
            ]) {
                expect(normalizeQaapAgentHookDeclaration(parseQaapAgentHooksConfig(variant).declaration)).to.not.equal(base);
            }
        });
    });

    describe('interpretQaapAgentHookResult', () => {
        const ok = (stdout: string): { exitCode: number; stdout: string; stderr: string; timedOut: boolean } => ({ exitCode: 0, stdout, stderr: '', timedOut: false });

        it('exit 2 blocks with stderr; PreToolUse becomes deny', () => {
            const blocked = { exitCode: 2, stdout: '', stderr: 'no secrets\n', timedOut: false };
            expect(interpretQaapAgentHookResult('UserPromptSubmit', blocked)).to.deep.equal({ outcome: 'block', reason: 'no secrets' });
            expect(interpretQaapAgentHookResult('PreToolUse', blocked)).to.deep.equal({ outcome: 'block', reason: 'no secrets', permissionDecision: 'deny' });
        });

        it('other exit codes, timeouts and spawn errors are non-blocking errors', () => {
            expect(interpretQaapAgentHookResult('PreToolUse', { exitCode: 1, stdout: '', stderr: 'boom', timedOut: false }).outcome).to.equal('error');
            expect(interpretQaapAgentHookResult('Stop', { stdout: '', stderr: '', timedOut: true }).outcome).to.equal('error');
            expect(interpretQaapAgentHookResult('Stop', { stdout: '', stderr: '', timedOut: false, error: 'ENOENT' }).outcome).to.equal('error');
        });

        it('plain stdout is extra context only for SessionStart / UserPromptSubmit', () => {
            expect(interpretQaapAgentHookResult('UserPromptSubmit', ok('branch: main\n'))).to.deep.equal({ outcome: 'success', additionalContext: 'branch: main' });
            expect(interpretQaapAgentHookResult('PreToolUse', ok('noise'))).to.deep.equal({ outcome: 'success' });
        });

        it('reads JSON PreToolUse decisions (top-level and hookSpecificOutput)', () => {
            expect(interpretQaapAgentHookResult('PreToolUse', ok('{"decision":"allow"}'))).to.deep.equal({ outcome: 'success', permissionDecision: 'allow' });
            expect(interpretQaapAgentHookResult('PreToolUse', ok('{"decision":"ask","reason":"check"}'))).to.deep.equal({ outcome: 'success', permissionDecision: 'ask', reason: 'check' });
            expect(interpretQaapAgentHookResult('PreToolUse', ok('{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"prod"}}')))
                .to.deep.equal({ outcome: 'block', permissionDecision: 'deny', reason: 'prod' });
            expect(interpretQaapAgentHookResult('PreToolUse', ok('{"decision":"block"}')).permissionDecision).to.equal('deny');
        });

        it('honours continue:false and JSON additionalContext', () => {
            expect(interpretQaapAgentHookResult('UserPromptSubmit', ok('{"continue":false,"stopReason":"frozen"}'))).to.deep.equal({ outcome: 'block', reason: 'frozen' });
            expect(interpretQaapAgentHookResult('SessionStart', ok('{"hookSpecificOutput":{"additionalContext":"ctx"}}')))
                .to.deep.equal({ outcome: 'success', additionalContext: 'ctx' });
        });
    });
});
