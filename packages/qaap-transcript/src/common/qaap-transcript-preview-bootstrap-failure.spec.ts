// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildTranscriptPreviewBootstrapFailureReason,
    resolveTranscriptBootstrapDiagnosticActivityItems,
    shouldReportTranscriptPreviewBootstrapFailure,
    TRANSCRIPT_PREVIEW_BOOTSTRAP_FAILURE_MAX_POLLS,
} from './qaap-transcript-preview-bootstrap-failure';

describe('qaap-transcript-preview-bootstrap-failure', () => {

    it('buildTranscriptPreviewBootstrapFailureReason returns undefined when preview is running', () => {
        expect(buildTranscriptPreviewBootstrapFailureReason({
            phase: 'running',
            previewUrl: 'http://localhost:5173/',
        })).to.equal(undefined);
    });

    it('buildTranscriptPreviewBootstrapFailureReason surfaces run-failed errors', () => {
        const reason = buildTranscriptPreviewBootstrapFailureReason({
            phase: 'run-failed',
            error: 'ENOENT package.json',
        });
        expect(reason).to.include('ENOENT package.json');
        expect(reason).to.include('Run & Preview');
    });

    it('buildTranscriptPreviewBootstrapFailureReason uses missingDescriptorHint when idle without descriptor', () => {
        const hint = 'No package.json found in workspace root or subfolders.';
        expect(buildTranscriptPreviewBootstrapFailureReason({
            phase: 'idle',
            missingDescriptorHint: hint,
        })).to.equal(hint);
    });

    it('buildTranscriptPreviewBootstrapFailureReason prompts install when deps missing', () => {
        expect(buildTranscriptPreviewBootstrapFailureReason({
            phase: 'idle',
            descriptor: { nodeModulesPresent: false },
        })).to.include('Dependencies are not installed');
    });

    it('shouldReportTranscriptPreviewBootstrapFailure reports terminal bootstrap phases immediately', () => {
        expect(shouldReportTranscriptPreviewBootstrapFailure({ phase: 'run-failed' }, 0)).to.equal(true);
        expect(shouldReportTranscriptPreviewBootstrapFailure({ phase: 'install-failed' }, 0)).to.equal(true);
    });

    it('shouldReportTranscriptPreviewBootstrapFailure waits for poll budget before idle-with-descriptor', () => {
        const snapshot = { phase: 'idle' as const, descriptor: { nodeModulesPresent: true } };
        expect(shouldReportTranscriptPreviewBootstrapFailure(snapshot, TRANSCRIPT_PREVIEW_BOOTSTRAP_FAILURE_MAX_POLLS - 1))
            .to.equal(false);
        expect(shouldReportTranscriptPreviewBootstrapFailure(snapshot, TRANSCRIPT_PREVIEW_BOOTSTRAP_FAILURE_MAX_POLLS))
            .to.equal(true);
    });

    it('shouldReportTranscriptPreviewBootstrapFailure does not report while installing or starting', () => {
        expect(shouldReportTranscriptPreviewBootstrapFailure({ phase: 'installing' }, 99)).to.equal(false);
        expect(shouldReportTranscriptPreviewBootstrapFailure({ phase: 'starting' }, 99)).to.equal(false);
    });

    it('resolveTranscriptBootstrapDiagnosticActivityItems surfaces orphan scaffold cwd', () => {
        const items = resolveTranscriptBootstrapDiagnosticActivityItems({
            phase: 'ready-to-run',
            previewRoot: 'rioja-wines-landing-page',
        });
        expect(items).to.have.length(1);
        expect(items[0]?.state).to.equal('success');
        expect(items[0]?.label).to.include('rioja-wines-landing-page');
        expect(items[0]?.label).to.include('not the workspace root');
    });

    it('resolveTranscriptBootstrapDiagnosticActivityItems surfaces run-failed root cause', () => {
        const items = resolveTranscriptBootstrapDiagnosticActivityItems({
            phase: 'run-failed',
            error: 'ENOENT package.json',
            previewRoot: 'rioja-wines-landing-page',
        });
        expect(items).to.have.length(2);
        expect(items[0]?.label).to.include('rioja-wines-landing-page');
        expect(items[1]?.state).to.equal('error');
        expect(items[1]?.label).to.include('Suggested fix');
    });

});
