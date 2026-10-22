// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type { QaapAgentTaskState } from '../common/qaap-agent-task';
import { classifyAgentLastTurn, QaapAgentLastTurnStore } from './qaap-agent-last-turn-store';

const task = (state: QaapAgentTaskState, exitCode?: number): { id: string; state: QaapAgentTaskState; exitCode?: number; finishedAt: number } =>
    ({ id: 't1', state, exitCode, finishedAt: 1000 });

const COPILOT_SIGNED_OUT = [
    'Error: No authentication information found.',
    'Copilot can be authenticated with GitHub using an OAuth Token or a Fine-Grained Personal Access Token.',
    "To authenticate, you can use any of the following methods: • Start 'copilot' and run the '/login' command"
    + ' • Set the COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN environment variable'
    + " • Run 'gh auth login' to authenticate with the GitHub CLI",
].join('\n');

describe('classifyAgentLastTurn', () => {

    it('a clean finish is ok, also with red repository checks or a blocked turn', () => {
        for (const state of ['completed', 'completed_with_warnings', 'blocked'] as const) {
            expect(classifyAgentLastTurn(task(state, 0), 'Done: edited src/a.ts', 'claude'))
                .to.deep.equal({ outcome: 'ok', at: 1000, taskId: 't1' }, state);
        }
    });

    it('prose that merely mentions auth does not fail a clean turn', () => {
        const log = 'I updated src/auth/login.ts so a user who is not logged in sees the OAuth session prompt.';
        expect(classifyAgentLastTurn(task('completed', 0), log, 'claude')?.outcome).to.equal('ok');
    });

    it('a CLI that prints its sign-in error and exits 0 (Copilot) is a failed auth turn', () => {
        expect(classifyAgentLastTurn(task('completed', 0), COPILOT_SIGNED_OUT, 'copilot'))
            .to.deep.equal({ outcome: 'failed', kind: 'auth', at: 1000, taskId: 't1' });
    });

    it('a stream-json is_error envelope on exit 0 is classified by its message', () => {
        const log = '{"type":"result","subtype":"error","is_error":true,"result":"HTTP 429: rate_limit_exceeded"}';
        expect(classifyAgentLastTurn(task('completed', 0), log, 'claude')?.kind).to.equal('rate_limit');
    });

    // One case per failure kind the Work Hub knows, as the CLI prints it before exiting non-zero.
    const failures: Array<[string, string]> = [
        ['auth', 'Error: invalid_api_key'],
        ['quota', 'Free credits for Kimi K2.6 are exhausted.'],
        ['rate_limit', 'HTTP 429: rate_limit_exceeded'],
        ['model_unavailable', 'model_not_found: kimi-k2.6'],
        ['tool_unsupported', 'The model tencent/hy3:free does not support tools.'],
        ['cli_missing', 'spawn qaiq ENOENT'],
        ['timeout', 'request timed out after 90s'],
        ['network', 'fetch failed: ECONNREFUSED'],
    ];
    for (const [kind, line] of failures) {
        it(`a failed turn ending in "${line}" is ${kind}`, () => {
            const log = `Working on the task...\n${'tool output\n'.repeat(50)}${line}\n`;
            expect(classifyAgentLastTurn(task('failed', 1), log, 'qaiq'))
                .to.deep.equal({ outcome: 'failed', kind, at: 1000, taskId: 't1' });
        });
    }

    it('the cause is read from the end of a long log, not cut off by its length', () => {
        const log = `${'x'.repeat(50_000)}\nspawn qaiq ENOENT\n`;
        expect(classifyAgentLastTurn(task('failed', 127), log, 'qaiq')?.kind).to.equal('cli_missing');
    });

    it('a non-zero exit without a recognisable cause is exit_code', () => {
        expect(classifyAgentLastTurn(task('failed', 2), 'Segmentation fault', 'codex'))
            .to.deep.equal({ outcome: 'failed', kind: 'exit_code', at: 1000, taskId: 't1' });
    });

    it('cancelled, interrupted (backend restart) and unfinished tasks say nothing about the agent', () => {
        for (const state of ['cancelled', 'interrupted', 'running', 'queued'] as const) {
            expect(classifyAgentLastTurn(task(state), 'spawn qaiq ENOENT', 'qaiq'), state).to.equal(undefined);
        }
    });
});

describe('QaapAgentLastTurnStore', () => {

    let directory: string;
    let previous: string | undefined;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-last-turn-'));
        previous = process.env.QAAP_SQLITE_STORE_PATH;
        process.env.QAAP_SQLITE_STORE_PATH = path.join(directory, 'store.sqlite');
    });

    afterEach(() => {
        if (previous === undefined) {
            delete process.env.QAAP_SQLITE_STORE_PATH;
        } else {
            process.env.QAAP_SQLITE_STORE_PATH = previous;
        }
        // Windows cannot delete a directory holding an open SQLite file (EBUSY).
        QaapSqliteConnectionRegistry.shared.closeUnder(directory);
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it('keeps the latest turn per user and agent, ignoring an older one that arrives late', () => {
        const store = new QaapAgentLastTurnStore();
        store.record('alice', 'claude', { outcome: 'failed', kind: 'auth', at: 200, taskId: 'b' });
        store.record('alice', 'claude', { outcome: 'ok', at: 100, taskId: 'a' });
        store.record('bob', 'claude', { outcome: 'ok', at: 300, taskId: 'c' });
        expect(store.get('alice', 'claude')).to.deep.equal({ outcome: 'failed', kind: 'auth', at: 200, taskId: 'b' });
        expect(store.get('bob', 'claude')?.taskId).to.equal('c');
        expect(store.get('alice', 'codex')).to.equal(undefined);
        // A new process reads what the previous one persisted.
        expect(new QaapAgentLastTurnStore().get('alice', 'claude')?.taskId).to.equal('b');
    });
});
