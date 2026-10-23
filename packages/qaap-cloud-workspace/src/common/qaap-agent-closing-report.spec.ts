// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildAgentClosingReport,
    formatAgentClosingReport,
    isQaapAgentClosingState,
    shouldSurfaceAgentClosingReport,
} from './qaap-agent-closing-report';

describe('qaap-agent-closing-report', () => {

    describe("state 'completed'", () => {
        it('folds passed checks, a passed review and the diff without surfacing a trace', () => {
            const report = buildAgentClosingReport({
                state: 'completed',
                exitCode: 0,
                verification: { status: 'passed', command: 'npm run build', attempts: 1 },
                review: { status: 'passed', reason: 'looks right', agentId: 'codex' },
                diff: { files: 3, added: 10, removed: 2 },
            })!;
            expect(report.state).to.equal('completed');
            expect(report.exitCode).to.equal(0);
            expect(report.headline).to.equal('Completed.');
            expect(report.details).to.deep.equal([
                'Checks: passed (npm run build) after 1 fix turn.',
                'Independent review: passed by codex — looks right.',
                'Changes: 3 files, +10 −2 lines.',
            ]);
            expect(shouldSurfaceAgentClosingReport(report)).to.equal(false);
        });

        it('names the pieces that did not run instead of omitting them', () => {
            const report = buildAgentClosingReport({ state: 'completed', exitCode: 0 })!;
            expect(report.verification).to.equal(undefined);
            expect(report.review).to.equal(undefined);
            expect(report.diff).to.equal(undefined);
            expect(report.details).to.deep.equal([
                'Checks: not run.',
                'Independent review: not run.',
                'Changes: not measured.',
            ]);
        });

        it('surfaces an inconclusive review: the change was not double-checked', () => {
            const report = buildAgentClosingReport({
                state: 'completed',
                review: { status: 'inconclusive', reason: 'Reviewer timed out before emitting a verdict.', agentId: 'claude' },
                diff: { added: 0, removed: 0 },
            })!;
            expect(report.headline).to.equal('Completed — the independent review produced no verdict.');
            expect(report.details[1]).to.equal('Independent review: no verdict by claude — Reviewer timed out before emitting a verdict.');
            expect(report.details[2]).to.equal('Changes: none.');
            expect(shouldSurfaceAgentClosingReport(report)).to.equal(true);
        });
    });

    describe("state 'completed_with_warnings'", () => {
        it('leads with red verification and carries its fix-turn count and summary', () => {
            const report = buildAgentClosingReport({
                state: 'completed_with_warnings',
                exitCode: 0,
                verification: { status: 'failed', command: 'npm run typecheck', attempts: 2, summary: 'src/a.ts(3,1): error TS2304' },
                diff: { files: 1, added: 4, removed: 0 },
            })!;
            expect(report.headline).to.equal('Completed with warnings — verification checks are failing.');
            expect(report.details[0]).to.equal('Checks: failing (npm run typecheck) after 2 fix turns. src/a.ts(3,1): error TS2304');
            expect(report.details[1]).to.equal('Independent review: not run.');
            expect(report.details[2]).to.equal('Changes: 1 file, +4 −0 lines.');
            expect(shouldSurfaceAgentClosingReport(report)).to.equal(true);
        });

        it('names a rejected review when the checks were green', () => {
            const report = buildAgentClosingReport({
                state: 'completed_with_warnings',
                verification: { status: 'passed', command: 'npm test', attempts: 0 },
                review: { status: 'failed', reason: '', agentId: 'codex' },
            })!;
            expect(report.headline).to.equal('Completed with warnings — the independent review rejected the change.');
            expect(report.details[0]).to.equal('Checks: passed (npm test).');
            expect(report.details[1]).to.equal('Independent review: rejected by codex — no reason given.');
        });

        it('caps a long verification summary', () => {
            const report = buildAgentClosingReport({
                state: 'completed_with_warnings',
                verification: { status: 'failed', command: 'npm run build', attempts: 0, summary: 'x'.repeat(2000) },
            })!;
            expect(report.details[0].length).to.be.lessThan(700);
            expect(report.details[0].endsWith('…')).to.equal(true);
        });
    });

    describe("state 'blocked'", () => {
        it('puts what the agent needs in the headline and keeps the warning facts', () => {
            const report = buildAgentClosingReport({
                state: 'blocked',
                exitCode: 0,
                verification: { status: 'failed', command: 'npm run build', attempts: 1, summary: 'red' },
                blockedNeed: '  Which database should I target?  ',
                diff: { files: 2, added: 5, removed: 5 },
            })!;
            expect(report.blockedNeed).to.equal('Which database should I target?');
            expect(report.headline).to.equal('Blocked — needs your input: Which database should I target?');
            expect(report.details[0]).to.equal('Checks: failing (npm run build) after 1 fix turn. red');
            expect(shouldSurfaceAgentClosingReport(report)).to.equal(true);
        });

        it('drops a blocked need on any other state', () => {
            const report = buildAgentClosingReport({ state: 'completed', blockedNeed: 'ignored' })!;
            expect(report.blockedNeed).to.equal(undefined);
        });
    });

    describe("state 'failed'", () => {
        it('reports the exit code', () => {
            const report = buildAgentClosingReport({ state: 'failed', exitCode: 2 })!;
            expect(report.headline).to.equal('Failed — the agent exited with code 2.');
            expect(shouldSurfaceAgentClosingReport(report)).to.equal(true);
        });

        it('reports a failure without an exit code', () => {
            expect(buildAgentClosingReport({ state: 'failed' })!.headline).to.equal('Failed — the agent did not finish.');
        });
    });

    it('builds no report for states outside the four closing states', () => {
        for (const state of ['queued', 'running', 'interrupted', 'cancelled'] as const) {
            expect(isQaapAgentClosingState(state)).to.equal(false);
            expect(buildAgentClosingReport({ state })).to.equal(undefined);
        }
    });

    it('describes pre-existing failures and skipped checks', () => {
        const preexisting = buildAgentClosingReport({
            state: 'completed',
            verification: { status: 'preexisting', command: 'npm test', attempts: 0, summary: 'old.spec.ts failing' },
        })!;
        expect(preexisting.details[0]).to.equal('Checks: failing only outside this change (npm test). old.spec.ts failing');
        const skipped = buildAgentClosingReport({ state: 'completed', verification: { status: 'skipped' } })!;
        expect(skipped.details[0]).to.equal('Checks: skipped.');
    });

    it('is deterministic: the same inputs render the same text', () => {
        const input = {
            state: 'completed_with_warnings' as const,
            verification: { status: 'failed' as const, command: 'npm test', attempts: 1, summary: 's' },
            diff: { files: 1, added: 1, removed: 1 },
        };
        const text = formatAgentClosingReport(buildAgentClosingReport(input)!);
        expect(formatAgentClosingReport(buildAgentClosingReport(input)!)).to.equal(text);
        expect(text.split('\n')).to.have.length(4);
    });
});
