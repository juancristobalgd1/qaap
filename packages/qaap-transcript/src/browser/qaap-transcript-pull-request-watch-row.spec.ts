// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { QaapPullRequestWatchSummary } from '@theia/qaap-shared-core/lib/common/qaap-pull-request-watch';
import {
    syncTranscriptPullRequestWatchRow,
    TRANSCRIPT_PR_WATCH_ROW_CLASS,
} from './qaap-transcript-pull-request-watch-row';

disableImportJSDOM();

function createRealChatHost(): HTMLElement {
    const host = document.createElement('div');
    host.className = 'theia-mobile-agent-transcript-real-chat';
    const list = document.createElement('div');
    list.className = 'theia-mobile-agent-transcript';
    host.append(list);
    document.body.append(host);
    return host;
}

const WATCHING: QaapPullRequestWatchSummary = {
    owner: 'acme',
    repo: 'demo',
    number: 544,
    url: 'https://github.com/acme/demo/pull/544',
    state: 'watching',
    startedBy: 'agent',
};

describe('syncTranscriptPullRequestWatchRow', () => {
    let disableJSDOM: (() => void) | undefined;
    let host: HTMLElement | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    afterEach(() => {
        host?.remove();
        host = undefined;
    });

    it('renders the watching row with label, Details and Stop, and removes it when stopped', () => {
        host = createRealChatHost();
        const opened: QaapPullRequestWatchSummary[] = [];
        syncTranscriptPullRequestWatchRow(host, { id: 'c1', pullRequestWatch: WATCHING }, {
            openDetails: watch => opened.push(watch),
        });

        const row = host.querySelector<HTMLElement>(`.${TRANSCRIPT_PR_WATCH_ROW_CLASS}`);
        expect(row).to.not.equal(null);
        expect(row?.textContent).to.include('Waiting · Watching pull request #544');
        const detailsBtn = row?.querySelector<HTMLButtonElement>('.theia-mod-details');
        expect(detailsBtn?.textContent).to.equal('Details');
        detailsBtn?.click();
        expect(opened).to.deep.equal([WATCHING]);

        syncTranscriptPullRequestWatchRow(host, { id: 'c1', pullRequestWatch: { ...WATCHING, state: 'stopped', stopReason: 'merged' } });
        expect(host.querySelector(`.${TRANSCRIPT_PR_WATCH_ROW_CLASS}`)).to.equal(null);
    });

    it('optimistically hides on Stop and calls stopWatch', async () => {
        host = createRealChatHost();
        const stopped: string[] = [];
        syncTranscriptPullRequestWatchRow(host, { id: 'c1', pullRequestWatch: WATCHING }, {
            stopWatch: async id => {
                stopped.push(id);
                return { id } as QaapAgentConversationDTO;
            },
        });

        const row = host.querySelector<HTMLElement>(`.${TRANSCRIPT_PR_WATCH_ROW_CLASS}`)!;
        row.querySelector<HTMLButtonElement>('.theia-mod-stop')!.click();
        expect(row.hidden).to.equal(true);
        expect(stopped).to.deep.equal(['c1']);
    });

    it('restores the row and reports an error if Stop fails', async () => {
        host = createRealChatHost();
        const errors: string[] = [];
        syncTranscriptPullRequestWatchRow(host, { id: 'c1', pullRequestWatch: WATCHING }, {
            stopWatch: async () => { throw new Error('network down'); },
            showError: msg => errors.push(msg),
        });

        const row = host.querySelector<HTMLElement>(`.${TRANSCRIPT_PR_WATCH_ROW_CLASS}`)!;
        row.querySelector<HTMLButtonElement>('.theia-mod-stop')!.click();
        expect(row.hidden).to.equal(true);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(row.hidden).to.equal(false);
        expect(errors).to.have.length(1);
        expect(errors[0]).to.include('network down');
    });
});
