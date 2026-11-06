// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import * as sinon from 'sinon';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectsTranscriptSurfacesUiContext } from './mobile-projects-transcript-surfaces-ui-context';
import {
    formatPreviewLaunchFailureDetail,
    refreshPreviewForBootstrapChangeExtracted,
    renderEmptyPreviewRunHintExtracted,
    resolveEmptyPreviewRunAppName,
} from './mobile-projects-transcript-surfaces-ui-tool-pills';

disableImportJSDOM();

describe('preview launch failure detail', () => {

    it('turns literal escaped line breaks into real lines and strips ANSI colors', () => {
        const raw = '\u001b[31merror\u001b[0m: boom\\nat main.js:1\\r\\nexit 1';
        const detail = formatPreviewLaunchFailureDetail(raw);
        expect(detail).to.equal('error: boom\nat main.js:1\nexit 1');
        expect(detail).to.not.contain('\\n');
        expect(detail).to.not.contain('\u001b');
    });

    it('keeps only the last lines of a long log and marks the cut with an ellipsis', () => {
        const lines = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`);
        const detail = formatPreviewLaunchFailureDetail(lines.join('\n')) ?? '';
        expect(detail.startsWith('line 39\n')).to.equal(true);
        expect(detail.endsWith('line 50')).to.equal(true);
        expect(detail.split('\n')).to.have.length(12);
        expect(detail).to.not.contain('line 38');
    });

    it('marks an ellipsis when the kept lines still exceed the character budget', () => {
        const longLine = 'x'.repeat(2000);
        const detail = formatPreviewLaunchFailureDetail(longLine) ?? '';
        expect(detail.startsWith('…')).to.equal(true);
        expect(detail.length).to.be.at.most(1201);
    });

    it('returns undefined for an empty or whitespace-only error', () => {
        expect(formatPreviewLaunchFailureDetail(undefined)).to.be.undefined;
        expect(formatPreviewLaunchFailureDetail('')).to.be.undefined;
        expect(formatPreviewLaunchFailureDetail('  \n \r\n ')).to.be.undefined;
    });
});

describe('empty Browser run hint', () => {

    const ROOT = 'file:///workspace/app';
    const readySnapshot = {
        phase: 'ready-to-run',
        descriptor: { name: 'app', devCommand: 'npm run dev', rootUri: { toString: () => ROOT } },
    };

    it('names the app only when the bootstrap is ready-to-run for this root', () => {
        expect(resolveEmptyPreviewRunAppName(readySnapshot, ROOT, false)).to.equal('app');
    });

    it('stays silent for a loaded URL, a running request, another root or no dev command', () => {
        expect(resolveEmptyPreviewRunAppName({ ...readySnapshot, previewUrl: 'http://localhost:5173/' }, ROOT, false)).to.equal(undefined);
        expect(resolveEmptyPreviewRunAppName(readySnapshot, ROOT, true)).to.equal(undefined);
        expect(resolveEmptyPreviewRunAppName(readySnapshot, 'file:///workspace/other', false)).to.equal(undefined);
        expect(resolveEmptyPreviewRunAppName({ ...readySnapshot, phase: 'installing' }, ROOT, false)).to.equal(undefined);
        expect(resolveEmptyPreviewRunAppName({ ...readySnapshot, phase: 'starting' }, ROOT, false)).to.equal(undefined);
        expect(resolveEmptyPreviewRunAppName({ ...readySnapshot, phase: 'running' }, ROOT, false)).to.equal(undefined);
        expect(resolveEmptyPreviewRunAppName({ phase: 'ready-to-run', descriptor: { name: 'app', rootUri: { toString: () => ROOT } } }, ROOT, false)).to.equal(undefined);
        expect(resolveEmptyPreviewRunAppName(undefined, ROOT, false)).to.equal(undefined);
    });

    describe('DOM card', () => {

        let disableDOM: () => void;
        before(() => {
            disableDOM = enableJSDOM();
        });
        after(() => {
            disableDOM();
        });

        function buildCtx(snapshot: unknown, launch: sinon.SinonSpy, root?: string): MobileProjectsTranscriptSurfacesUiContext {
            const panel = document.createElement('div');
            panel.className = root ?? 'theia-mod-empty-preview';
            panel.innerHTML = '<div class="qaap-preview-frame-slot"></div>';
            return {
                host: {
                    transcriptEmbeddedPreview: { root: panel },
                    transcriptOpenProject: undefined,
                    transcriptPreviewRequestRunning: false,
                    transcriptPreviewRequestPending: false,
                    projectBootstrap: { getStateSnapshot: () => snapshot },
                    transcriptStickyComposerUi: { launchComposerDevPreview: launch },
                },
                resolveRunnableTranscriptProjectRoot: () => '/workspace/app',
            } as unknown as MobileProjectsTranscriptSurfacesUiContext;
        }
        const project = { id: 'p1' } as unknown as MobileProjectEntry;
        const summary = { id: 'c1' } as unknown as QaapAgentConversationSummaryDTO;

        it('offers Run & Preview for the runnable app and launches the composer action on click', () => {
            const launch = sinon.spy();
            const ctx = buildCtx({
                phase: 'ready-to-run',
                descriptor: { name: 'app', devCommand: 'npm run dev', rootUri: { toString: () => 'file:///workspace/app' } },
            }, launch);
            renderEmptyPreviewRunHintExtracted(ctx, project, summary);
            const card = ctx.host.transcriptEmbeddedPreview!.root.querySelector('.theia-mobile-transcript-preview-run-hint')!;
            expect(card.querySelector('p')!.textContent).to.equal('Run app to preview it here.');
            const button = card.querySelector('button')!;
            expect(button.textContent).to.equal('Run & Preview');
            button.click();
            expect(launch.calledOnceWith(project, summary)).to.equal(true);
        });

        it('paints no Run card while the bootstrap of this project starts or runs', () => {
            for (const phase of ['starting', 'running'] as const) {
                const ctx = buildCtx({
                    phase,
                    descriptor: { name: 'app', devCommand: 'npm run dev', rootUri: { toString: () => 'file:///workspace/app' } },
                }, sinon.spy());
                renderEmptyPreviewRunHintExtracted(ctx, project, summary);
                expect(ctx.host.transcriptEmbeddedPreview!.root.querySelector('.theia-mobile-transcript-preview-run-hint')).to.equal(null);
            }
        });

        it('leaves the empty state alone without a runnable app', () => {
            const ctx = buildCtx({ phase: 'detected' }, sinon.spy());
            renderEmptyPreviewRunHintExtracted(ctx, project, summary);
            expect(ctx.host.transcriptEmbeddedPreview!.root.querySelector('.theia-mobile-transcript-preview-run-hint')).to.equal(null);
        });

        it('does nothing once the user navigated away from the empty state', () => {
            const ctx = buildCtx({
                phase: 'ready-to-run',
                descriptor: { name: 'app', devCommand: 'npm run dev', rootUri: { toString: () => 'file:///workspace/app' } },
            }, sinon.spy(), 'theia-mod-user-navigated');
            renderEmptyPreviewRunHintExtracted(ctx, project, summary);
            expect(ctx.host.transcriptEmbeddedPreview!.root.querySelector('.theia-mobile-transcript-preview-run-hint')).to.equal(null);
        });
    });
});

describe('Browser view follows the active project after a bootstrap change', () => {

    function buildCtx(options: { activeId: string, openId: string, tab?: string }): {
        ctx: MobileProjectsTranscriptSurfacesUiContext,
        renderPreviewTab: sinon.SinonSpy,
        updateLaunchStatus: sinon.SinonSpy,
    } {
        const renderPreviewTab = sinon.spy();
        const updateLaunchStatus = sinon.spy();
        const projects = [{ id: 'qaap' }, { id: 'vyyq' }] as unknown as MobileProjectEntry[];
        const ctx = {
            transcriptPreviewProjectId: options.activeId,
            host: {
                projects,
                transcriptOpenSummary: { id: 'c1' },
                transcriptOpenProject: projects.find(candidate => candidate.id === options.openId),
                transcriptEmbeddedPreview: undefined,
                executionSurfaceTabsUi: { activeExecutionTab: () => options.tab ?? 'preview' },
            },
            renderPreviewTab,
            updateTranscriptPreviewLaunchStatus: updateLaunchStatus,
        } as unknown as MobileProjectsTranscriptSurfacesUiContext;
        return { ctx, renderPreviewTab, updateLaunchStatus };
    }

    it('re-renders the preview of the project on screen after its bootstrap changes', () => {
        const { ctx, renderPreviewTab, updateLaunchStatus } = buildCtx({ activeId: 'vyyq', openId: 'vyyq' });
        refreshPreviewForBootstrapChangeExtracted(ctx);
        expect(renderPreviewTab.calledOnce).to.equal(true);
        expect((renderPreviewTab.firstCall.args[0] as MobileProjectEntry).id).to.equal('vyyq');
        expect(updateLaunchStatus.calledOnce).to.equal(true);
    });

    it('does not touch the Browser view for a project that is not on screen', () => {
        const { ctx, renderPreviewTab } = buildCtx({ activeId: 'vyyq', openId: 'qaap' });
        refreshPreviewForBootstrapChangeExtracted(ctx);
        expect(renderPreviewTab.called).to.equal(false);
    });

    it('does not touch the Browser view while another execution tab is shown', () => {
        const { ctx, renderPreviewTab } = buildCtx({ activeId: 'vyyq', openId: 'vyyq', tab: 'files' });
        refreshPreviewForBootstrapChangeExtracted(ctx);
        expect(renderPreviewTab.called).to.equal(false);
    });
});
