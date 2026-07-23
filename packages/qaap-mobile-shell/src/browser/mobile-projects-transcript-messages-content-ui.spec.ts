// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as markdownit from '@theia/core/shared/markdown-it';
import { parseHTML } from 'linkedom';
import {
    TRANSCRIPT_STREAM_FROZEN_CLASS,
    TRANSCRIPT_STREAM_PLAIN_PREVIEW_CLASS,
    TRANSCRIPT_STREAM_TAIL_CLASS,
    applyStreamingMarkdownHtmlPatch,
} from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-streaming-markdown-view';
import {
    extractTranscriptPreviewId,
    isTranscriptPreviewHrefShellSelf,
    MobileProjectsTranscriptMessagesContentUi,
    normalizeTranscriptPreviewHref,
    TRANSCRIPT_STREAMING_HYBRID_CLASS,
    TRANSCRIPT_STREAMING_INCREMENTAL_MARKDOWN_CLASS,
    TRANSCRIPT_STREAMING_INCREMENTAL_MIN_CHARS,
    TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS,
    transcriptContentNeedsStreamingMarkdown,
} from './mobile-projects-transcript-messages-content-ui';
import { QaapTranscriptMarkdownWorkerClient } from './qaap-transcript-markdown-worker-client';
import { MobileSnackbar } from './mobile-snackbar';

describe('MobileProjectsTranscriptMessagesContentUi', () => {

    const { document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    let previousDocument: Document | undefined;

    before(() => {
        previousDocument = globalThis.document;
        (globalThis as typeof globalThis & { document: Document }).document = document as unknown as Document;
    });

    after(() => {
        if (previousDocument) {
            (globalThis as typeof globalThis & { document: Document }).document = previousDocument;
        }
    });

    beforeEach(() => {
        if (typeof window !== 'undefined') {
            const testWindow = window as Partial<Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>>;
            delete testWindow.requestAnimationFrame;
            delete testWindow.cancelAnimationFrame;
        }
        QaapTranscriptMarkdownWorkerClient.resetForTests();
        const client = QaapTranscriptMarkdownWorkerClient.get();
        (client as unknown as { requestStreamingPatch: () => void }).requestStreamingPatch = () => { /* tested via direct HTML patch */ };
    });

    it('renderTranscriptStreamingMarkdown keeps short prose streams as plain text', () => {
        const host = document.createElement('div');
        host.className = 'theia-mobile-agent-transcript-content';
        const ui = new MobileProjectsTranscriptMessagesContentUi({
            transcriptMarkdownIt: markdownit(),
        } as never);
        ui.renderTranscriptStreamingMarkdown(host, '**Hello** `world`');
        expect(host.classList.contains(TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS)).to.equal(true);
        expect(host.classList.contains(TRANSCRIPT_STREAMING_INCREMENTAL_MARKDOWN_CLASS)).to.equal(false);
        expect(host.textContent).to.equal('**Hello** `world`');
        expect(host.querySelector('strong')).to.equal(null);
    });

    it('renderTranscriptMarkdown shows plain text while worker markdown is pending', () => {
        const host = document.createElement('div');
        const ui = new MobileProjectsTranscriptMessagesContentUi({
            transcriptMarkdownIt: markdownit(),
        } as never);
        const client = QaapTranscriptMarkdownWorkerClient.get();
        (client as unknown as { requestParse: () => void }).requestParse = () => { /* simulate pending worker */ };

        ui.renderTranscriptMarkdown(host, '**Agent response**');

        expect(host.classList.contains('theia-mod-markdown')).to.equal(true);
        expect(host.textContent).to.equal('**Agent response**');
        expect(host.querySelector('strong')).to.equal(null);
    });

    it('transcriptContentNeedsStreamingMarkdown detects fenced code and tables', () => {
        expect(transcriptContentNeedsStreamingMarkdown('short prose')).to.equal(false);
        expect(transcriptContentNeedsStreamingMarkdown('```js\nx\n```')).to.equal(true);
        expect(transcriptContentNeedsStreamingMarkdown('| a | b |\n|---|---|')).to.equal(true);
        expect(transcriptContentNeedsStreamingMarkdown('word '.repeat(TRANSCRIPT_STREAMING_INCREMENTAL_MIN_CHARS))).to.equal(true);
    });

    it('renderTranscriptStreamingMarkdown uses hybrid mode for short fenced code', () => {
        const host = document.createElement('div');
        host.className = 'theia-mobile-agent-transcript-content';
        const ui = new MobileProjectsTranscriptMessagesContentUi({
            transcriptMarkdownIt: markdownit(),
        } as never);
        ui.renderTranscriptStreamingMarkdown(host, '```js\nconst x = 1;\n```');
        expect(host.classList.contains(TRANSCRIPT_STREAMING_HYBRID_CLASS)).to.equal(true);
        expect(host.classList.contains(TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS)).to.equal(false);
    });

    it('renderTranscriptStreamingMarkdown mounts hybrid plain preview for long streams', () => {
        const host = document.createElement('div');
        host.className = 'theia-mobile-agent-transcript-content';
        const ui = new MobileProjectsTranscriptMessagesContentUi({
            transcriptMarkdownIt: markdownit(),
        } as never);
        const long = '# Title\n\n' + 'word '.repeat(TRANSCRIPT_STREAMING_INCREMENTAL_MIN_CHARS);
        ui.renderTranscriptStreamingMarkdown(host, long);
        expect(host.classList.contains(TRANSCRIPT_STREAMING_HYBRID_CLASS)).to.equal(true);
        expect(host.classList.contains(TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS)).to.equal(false);
        const preview = host.querySelector<HTMLElement>(`.${TRANSCRIPT_STREAM_PLAIN_PREVIEW_CLASS}`);
        expect(preview?.textContent).to.contain('# Title');
    });

    it('renderTranscriptStreamingMarkdown updates plain preview suffix while worker HTML is partial', () => {
        const host = document.createElement('div');
        const ui = new MobileProjectsTranscriptMessagesContentUi({
            transcriptMarkdownIt: markdownit(),
        } as never);
        const prefix = '# Title\n\n' + 'word '.repeat(TRANSCRIPT_STREAMING_INCREMENTAL_MIN_CHARS);
        ui.renderTranscriptStreamingMarkdown(host, prefix);
        host.dataset.qaapStreamTotalLength = String(prefix.length);
        applyStreamingMarkdownHtmlPatch(host, {
            stableLength: 0,
            totalLength: prefix.length,
            tailHtml: '<h1>Title</h1>',
        });
        host.classList.add('theia-mod-markdown', TRANSCRIPT_STREAMING_INCREMENTAL_MARKDOWN_CLASS, TRANSCRIPT_STREAMING_HYBRID_CLASS);
        ui.renderTranscriptStreamingMarkdown(host, prefix + 'live');
        const preview = host.querySelector<HTMLElement>(`.${TRANSCRIPT_STREAM_PLAIN_PREVIEW_CLASS}`);
        expect(preview?.textContent).to.equal('live');
        expect(host.querySelector('h1')?.textContent).to.equal('Title');
    });

    it('applyTranscriptStreamingMarkdownHtml mounts worker frozen/tail without markdown-it on host', () => {
        const host = document.createElement('div');
        const ui = new MobileProjectsTranscriptMessagesContentUi({
            transcriptMarkdownIt: markdownit(),
        } as never);
        const long = '# Title\n\n' + 'word '.repeat(TRANSCRIPT_STREAMING_INCREMENTAL_MIN_CHARS);
        ui.renderTranscriptStreamingMarkdown(host, long);
        applyStreamingMarkdownHtmlPatch(host, {
            stableLength: 0,
            totalLength: long.length,
            tailHtml: '<h1>Title</h1><p>Rendered</p>',
        });
        host.classList.remove(TRANSCRIPT_STREAMING_PLAIN_TEXT_CLASS);
        host.classList.add('theia-mod-markdown', TRANSCRIPT_STREAMING_INCREMENTAL_MARKDOWN_CLASS);
        expect(host.querySelector(`.${TRANSCRIPT_STREAM_FROZEN_CLASS}`)).to.not.equal(null);
        expect(host.querySelector(`.${TRANSCRIPT_STREAM_TAIL_CLASS}`)).to.not.equal(null);
        expect(host.querySelector('h1')?.textContent).to.equal('Title');
    });

    it('renderTranscriptStreamingMarkdown stays fast across many SSE-sized updates', () => {
        const host = document.createElement('div');
        const ui = new MobileProjectsTranscriptMessagesContentUi({
            transcriptMarkdownIt: markdownit(),
        } as never);
        const prefix = '## Streaming\n\n' + 'line of prose. '.repeat(400);
        const start = performance.now();
        for (let i = 0; i < 600; i++) {
            ui.renderTranscriptStreamingMarkdown(host, prefix + ' token-' + i);
        }
        const elapsedMs = performance.now() - start;
        expect(elapsedMs).to.be.below(120);
        expect(host.classList.contains(TRANSCRIPT_STREAMING_HYBRID_CLASS)).to.equal(true);
    });

    it('recognizes identity proxy and isolated-origin links as integrated previews', () => {
        const origin = 'https://app.qaap.example';
        const previewId = 'project-conversation-run-a1b2c3';
        expect(normalizeTranscriptPreviewHref(`/qaap-preview/${previewId}/dashboard`, origin))
            .to.equal(`${origin}/qaap-preview/${previewId}/dashboard`);
        const isolated = `https://${previewId}.preview.qaap.example/dashboard`;
        expect(normalizeTranscriptPreviewHref(isolated, origin)).to.equal(isolated);
        expect(extractTranscriptPreviewId(isolated, origin)).to.equal(previewId);
        expect(normalizeTranscriptPreviewHref('https://example.com/dashboard', origin)).to.equal(undefined);
        expect(normalizeTranscriptPreviewHref('/qaap-preview/api/probe', origin)).to.equal(undefined);
        expect(normalizeTranscriptPreviewHref(`ftp://${previewId}.preview.qaap.example/`, origin)).to.equal(undefined);
    });

    it('isTranscriptPreviewHrefShellSelf detects the IDE URL itself', () => {
        const origin = 'http://localhost:3000';
        expect(isTranscriptPreviewHrefShellSelf('http://localhost:3000', origin)).to.equal(true);
        expect(isTranscriptPreviewHrefShellSelf('http://localhost:3000/', origin)).to.equal(true);
        expect(isTranscriptPreviewHrefShellSelf('http://127.0.0.1:3000', origin)).to.equal(true);
        expect(isTranscriptPreviewHrefShellSelf('http://localhost:5173', origin)).to.equal(false);
        expect(isTranscriptPreviewHrefShellSelf('/qaap-dev/5173/', origin)).to.equal(false);
        expect(isTranscriptPreviewHrefShellSelf('/qaap-preview/project-run-abc/', origin)).to.equal(false);
    });

    it('openTranscriptPreviewUrlFromLink treats shell-self links as already-here', async () => {
        let selectedTab = '';
        let snackbarKind: string | undefined;
        const host = {
            transcriptComposerSummary: { id: 'conversation' },
            transcriptOpenSummary: { id: 'conversation' },
            transcriptOpenProject: { id: 'project', name: 'Project' },
            projects: [{ id: 'project', name: 'Project' }],
            projectsService: {
                recordProjectPreviewUrl: async (): Promise<void> => undefined,
            },
            executionSurfaceTabsUi: {
                selectTranscriptTab: (tab: string): void => {
                    selectedTab = tab;
                },
            },
            transcriptPreviewRequestPending: false,
            transcriptPreviewRequestRunning: false,
        };
        const ui = new MobileProjectsTranscriptMessagesContentUi(host as never);
        (ui as unknown as { previewPublicOrigin: () => string }).previewPublicOrigin = () => 'http://localhost:3000';
        const snackbar = MobileSnackbar as typeof MobileSnackbar & { show: typeof MobileSnackbar.show };
        const originalShow = snackbar.show;
        let shown = false;
        snackbar.show = (_message, options) => {
            shown = true;
            snackbarKind = options?.kind;
        };
        try {
            const opened = await ui.openTranscriptPreviewUrlFromLink('http://localhost:3000');
            expect(opened).to.equal(true);
            expect(selectedTab).to.equal('');
            expect(shown).to.equal(true);
            expect(snackbarKind === undefined || snackbarKind === 'default').to.equal(true);
        } finally {
            snackbar.show = originalShow;
        }
    });

    it('linkifies previewId URLs returned as plain agent text', () => {
        const ui = new MobileProjectsTranscriptMessagesContentUi({} as never);
        const previewId = 'project-conversation-run-a1b2c3';
        const linked = ui.linkifyTranscriptPreviewUrls(
            `Abre /qaap-preview/${previewId}/ o https://${previewId}.preview.qaap.example/`,
        );
        expect(linked).to.contain(`[/qaap-preview/${previewId}/](/qaap-preview/${previewId}/)`);
        expect(linked).to.contain(
            `[https://${previewId}.preview.qaap.example/](https://${previewId}.preview.qaap.example/)`,
        );
    });

    it('validates an identity link and selects the integrated Preview tab', async () => {
        const previewId = 'project-conversation-run-a1b2c3';
        const verifiedUrl = `https://${previewId}.preview.qaap.example/`;
        let selectedTab = '';
        let persistedUrl = '';
        const project = { id: 'project', name: 'Project' };
        const summary = { id: 'conversation' };
        const host = {
            transcriptComposerSummary: summary,
            transcriptOpenSummary: summary,
            transcriptOpenProject: project,
            projects: [project],
            projectsService: {
                recordProjectPreviewUrl: async (_project: unknown, url: string): Promise<void> => {
                    persistedUrl = url;
                },
            },
            executionSurfaceTabsUi: {
                selectTranscriptTab: (tab: string): void => {
                    selectedTab = tab;
                },
            },
            transcriptPreviewRequestPending: true,
            transcriptPreviewRequestRunning: true,
        };
        const ui = new MobileProjectsTranscriptMessagesContentUi(host as never);
        const testUi = ui as unknown as {
            previewPublicOrigin: () => string;
            probePreviewIdentity: (id: string) => Promise<{ ready: boolean; previewUrl: string; previewId: string }>;
        };
        testUi.previewPublicOrigin = () => 'https://app.qaap.example';
        testUi.probePreviewIdentity = async id => ({ ready: true, previewUrl: verifiedUrl, previewId: id });
        const snackbar = MobileSnackbar as typeof MobileSnackbar & { show: typeof MobileSnackbar.show };
        const originalShow = snackbar.show;
        snackbar.show = () => { /* no DOM timer in this unit test */ };
        try {
            const opened = await ui.openTranscriptPreviewUrlFromLink(`/qaap-preview/${previewId}/`);
            expect(opened).to.equal(true);
            expect(selectedTab).to.equal('preview');
            expect(persistedUrl).to.equal(verifiedUrl);
            expect(host.transcriptOpenProject).to.deep.include({ previewUrl: verifiedUrl });
            expect(host.transcriptPreviewRequestPending).to.equal(false);
            expect(host.transcriptPreviewRequestRunning).to.equal(false);
        } finally {
            snackbar.show = originalShow;
        }
    });
});
