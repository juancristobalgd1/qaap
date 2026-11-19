// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildAgentReviewPrompt,
    groundAgentReviewVerdict,
    parseAgentReviewVerdict,
    parseGitNumstat,
    resolveAgentReviewMode,
    resolveTaskReviewRisk,
} from './qaap-agent-review';

describe('resolveAgentReviewMode', () => {
    it('defaults to high-risk and honors off/all', () => {
        expect(resolveAgentReviewMode(undefined)).to.equal('high-risk');
        expect(resolveAgentReviewMode('high-risk')).to.equal('high-risk');
        expect(resolveAgentReviewMode('garbage')).to.equal('high-risk');
        expect(resolveAgentReviewMode('all')).to.equal('all');
        for (const off of ['off', '0', 'false', 'no', ' OFF ']) {
            expect(resolveAgentReviewMode(off)).to.equal('off');
        }
    });
});

describe('parseGitNumstat', () => {
    it('parses added/removed/path lines and treats binary counts as 0', () => {
        const files = parseGitNumstat('12\t3\tsrc/app.ts\n-\t-\tlogo.png\n');
        expect(files).to.deep.equal([
            { path: 'src/app.ts', added: 12, removed: 3 },
            { path: 'logo.png', added: 0, removed: 0 },
        ]);
        expect(parseGitNumstat('')).to.deep.equal([]);
        expect(parseGitNumstat(undefined)).to.deep.equal([]);
    });
});

describe('resolveTaskReviewRisk', () => {
    it('classifies small non-sensitive diffs as low', () => {
        expect(resolveTaskReviewRisk([{ path: 'src/util/date.ts', added: 5, removed: 2 }])).to.equal('low');
        expect(resolveTaskReviewRisk([])).to.equal('low');
    });

    it('flags size: 3+ files or 40+ changed lines', () => {
        expect(resolveTaskReviewRisk([
            { path: 'a.ts', added: 1, removed: 0 },
            { path: 'b.ts', added: 1, removed: 0 },
            { path: 'c.ts', added: 1, removed: 0 },
        ])).to.equal('high');
        expect(resolveTaskReviewRisk([{ path: 'a.ts', added: 30, removed: 10 }])).to.equal('high');
    });

    it('flags sensitive paths regardless of size', () => {
        for (const path of [
            'src/auth/guard.ts',
            'lib/paymentGateway.js',
            'config/.env.production',
            'db/migrations/001-init.sql',
            'package.json',
            'yarn.lock',
        ]) {
            expect(resolveTaskReviewRisk([{ path, added: 1, removed: 0 }]), path).to.equal('high');
        }
    });
});

describe('parseAgentReviewVerdict', () => {
    it('reads the sentinel inside raw stream-json output and takes the last occurrence', () => {
        const raw = '{"type":"text","text":"Reviewing...\\n@@QAAP:VERDICT@@ pass early partial"}\n'
            + '{"type":"result","text":"Done.\\n@@QAAP:VERDICT@@ fail introduces an unvalidated cwd parameter"}';
        expect(parseAgentReviewVerdict(raw)).to.deep.equal({
            status: 'failed',
            reason: 'introduces an unvalidated cwd parameter',
        });
    });

    it('parses a plain-text pass verdict', () => {
        expect(parseAgentReviewVerdict('All good.\n@@QAAP:VERDICT@@ pass matches the request')).to.deep.equal({
            status: 'passed',
            reason: 'matches the request',
        });
    });

    it('returns undefined when no sentinel was emitted', () => {
        expect(parseAgentReviewVerdict('reviewer crashed mid-flight')).to.equal(undefined);
        expect(parseAgentReviewVerdict('')).to.equal(undefined);
        expect(parseAgentReviewVerdict(undefined)).to.equal(undefined);
    });

    it('is not satisfied by the reviewer prompt itself (no marker+verdict adjacency)', () => {
        const prompt = buildAgentReviewPrompt({ originalCommand: 'claude -p "fix login"', diff: '+ x' });
        expect(parseAgentReviewVerdict(prompt)).to.equal(undefined);
    });
});

describe('buildAgentReviewPrompt', () => {
    it('inlines the capped diff, forbids edits, and demands the sentinel', () => {
        const prompt = buildAgentReviewPrompt({ originalCommand: 'codex exec "add export"', diff: 'x'.repeat(50), diffCapChars: 10 });
        expect(prompt).to.include('Do NOT edit any file');
        expect(prompt).to.include('@@QAAP:VERDICT@@');
        expect(prompt).to.include('Do not start an application, dev server, watcher');
        expect(prompt).to.include('(diff truncated)');
        expect(prompt).to.include('codex exec "add export"');
    });

    it('passes Qaap check evidence to the reviewer as PASSED / FAILED / not run', () => {
        const passed = buildAgentReviewPrompt({
            originalCommand: 'add export',
            diff: 'diff',
            verification: { status: 'passed', command: 'npm run build', attempts: 1 },
        });
        expect(passed).to.include('Qaap checks for this turn: PASSED — `npm run build` (1 fix turn(s)).');

        const failed = buildAgentReviewPrompt({
            originalCommand: 'add export',
            diff: 'diff',
            verification: { status: 'failed', command: 'node --check src/a.js', attempts: 0, summary: 'SyntaxError: Unexpected token' },
        });
        expect(failed).to.include('FAILED — `node --check src/a.js` after 0 fix turn(s): SyntaxError: Unexpected token');

        expect(buildAgentReviewPrompt({ originalCommand: 'x', diff: 'd' })).to.include('Qaap checks for this turn: not run.');
    });

    it('states that style and rewrites are notes, not grounds to fail', () => {
        const prompt = buildAgentReviewPrompt({ originalCommand: 'x', diff: 'd' });
        expect(prompt).to.include('NOT grounds for FAIL');
        expect(prompt).to.include('MUST start with the defect as path:line');
    });
});

describe('parseAgentReviewVerdict notes', () => {
    it('splits the notes off the reason on the verdict line', () => {
        const verdict = parseAgentReviewVerdict('@@QAAP:VERDICT@@ fail server.js:12 — bad guard || notes: rename foo');
        expect(verdict).to.deep.equal({ status: 'failed', reason: 'server.js:12 — bad guard', notes: 'rename foo' });
    });

    it('leaves notes out of the result when none are given', () => {
        expect(parseAgentReviewVerdict('@@QAAP:VERDICT@@ pass looks right')).to.deep.equal({ status: 'passed', reason: 'looks right' });
    });
});

describe('groundAgentReviewVerdict', () => {
    it('records a rejection with no file:line defect as approved with notes (fixture: server.js rewrites)', () => {
        const verdict = parseAgentReviewVerdict('@@QAAP:VERDICT@@ fail server.js rewrites');
        const grounded = groundAgentReviewVerdict(verdict!);
        expect(grounded.status).to.equal('passed');
        expect(grounded.reason).to.contain('approved with notes');
        expect(grounded.reason).to.contain('server.js rewrites');
    });

    it('keeps a rejection that cites a concrete path:line defect blocking (fixture: real syntax error)', () => {
        // No double quotes in the fixture: the sentinel reason stops at a quote by design.
        const verdict = parseAgentReviewVerdict('@@QAAP:VERDICT@@ fail src/a.js:3 — SyntaxError: Unexpected token )');
        const grounded = groundAgentReviewVerdict(verdict!);
        expect(grounded.status).to.equal('failed');
        expect(grounded.reason).to.equal('src/a.js:3 — SyntaxError: Unexpected token )');
    });

    it('keeps a backticked citation blocking too', () => {
        expect(groundAgentReviewVerdict({ status: 'failed', reason: '`src/a.ts:10` breaks the export' }).status).to.equal('failed');
    });

    it('does not treat a bare word or a path without a line as a citation', () => {
        expect(groundAgentReviewVerdict({ status: 'failed', reason: 'src/a.ts is messy' }).status).to.equal('passed');
        expect(groundAgentReviewVerdict({ status: 'failed', reason: 'rewrites:12' }).status).to.equal('passed');
    });

    it('passes a pass through and keeps its notes', () => {
        expect(groundAgentReviewVerdict({ status: 'passed', reason: 'matches the request', notes: 'rename x' }))
            .to.deep.equal({ status: 'passed', reason: 'matches the request (notes: rename x)' });
    });
});
