// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import * as markdownit from '@theia/core/shared/markdown-it';
import type { WorkHubTranscriptPullRequestRef } from '@theia/qaap-transcript-overlay/lib/browser/work-hub-transcript-bridge';
import { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import {
    decorateTranscriptPullRequestChips,
    findTranscriptPullRequestTextMatches,
    parseTranscriptPullRequestUrl,
    readTranscriptPullRequestChip,
    transcriptPullRequestChipLabel,
} from './qaap-transcript-pull-request-chips';

disableImportJSDOM();

describe('qaap-transcript-pull-request-chips', () => {

    let disableJSDOM: (() => void) | undefined;
    const repo = { owner: 'acme', name: 'app' };
    const md = markdownit({ linkify: true });

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    function render(markdown: string, withRepo = true): HTMLElement {
        const host = document.createElement('div');
        host.innerHTML = md.render(markdown);
        decorateTranscriptPullRequestChips(host, withRepo ? repo : undefined);
        return host;
    }

    const chips = (host: HTMLElement): string[] =>
        Array.from(host.querySelectorAll('.qaap-transcript-pr-chip')).map(chip => chip.textContent ?? '');

    describe('detection', () => {
        it('finds #n, PR #n and pull request #n', () => {
            expect(findTranscriptPullRequestTextMatches('See #117, PR #12 and pull request #3.').map(match => match.number))
                .to.deep.equal([117, 12, 3]);
        });

        it('skips issue references, hex colors and ids glued to words', () => {
            expect(findTranscriptPullRequestTextMatches('issue #42')).to.deep.equal([]);
            expect(findTranscriptPullRequestTextMatches('closes issues #42')).to.deep.equal([]);
            expect(findTranscriptPullRequestTextMatches('color #123456 and #abc')).to.deep.equal([]);
            expect(findTranscriptPullRequestTextMatches('the background is #333')).to.deep.equal([]);
            expect(findTranscriptPullRequestTextMatches('a#12 and https://x.dev/page#12 and &#39;')).to.deep.equal([]);
        });

        it('keeps PR #n even next to colour words, and rejects #0', () => {
            expect(findTranscriptPullRequestTextMatches('the colour fix is PR #333')).to.have.length(1);
            expect(findTranscriptPullRequestTextMatches('#0')).to.deep.equal([]);
        });

        it('parses GitHub pull URLs only', () => {
            expect(parseTranscriptPullRequestUrl('https://github.com/acme/app/pull/117/files')).to.deep.include({ owner: 'acme', repo: 'app', number: 117 });
            expect(parseTranscriptPullRequestUrl('https://github.com/acme/app/issues/117')).to.equal(undefined);
            expect(parseTranscriptPullRequestUrl('https://gitlab.com/acme/app/pull/117')).to.equal(undefined);
        });

        it('labels own-repo chips #n and other repos owner/repo#n', () => {
            const own: WorkHubTranscriptPullRequestRef = { owner: 'Acme', repo: 'App', number: 5, url: 'u' };
            expect(transcriptPullRequestChipLabel(own, repo)).to.equal('#5');
            expect(transcriptPullRequestChipLabel({ ...own, owner: 'other' }, repo)).to.equal('other/App#5');
            expect(transcriptPullRequestChipLabel(own, undefined)).to.equal('Acme/App#5');
        });
    });

    describe('render', () => {
        it('turns #n and PR #n in prose into inline chips with the GitHub icon', () => {
            const host = render('Opened PR #117 for the fix, see also #118.');
            expect(chips(host)).to.deep.equal(['#117', '#118']);
            const chip = host.querySelector<HTMLAnchorElement>('.qaap-transcript-pr-chip')!;
            expect(chip.querySelector('.codicon-github')).to.not.equal(null);
            expect(chip.getAttribute('href')).to.equal('https://github.com/acme/app/pull/117');
            expect(host.textContent?.trim()).to.equal('Opened #117 for the fix, see also #118.');
        });

        it('turns pull URLs (autolinked and markdown links) into chips, other repos as owner/repo#n', () => {
            const host = render('Own https://github.com/acme/app/pull/9 and [other](https://github.com/zed/lib/pull/4).');
            expect(chips(host)).to.deep.equal(['#9', 'zed/lib#4']);
            expect(host.querySelectorAll('a:not(.qaap-transcript-pr-chip)')).to.have.length(0);
            expect(host.querySelectorAll('.qaap-transcript-pr-chip')[1].getAttribute('title')).to.equal('other');
        });

        it('still chips URLs when the conversation has no GitHub repo, but not bare numbers', () => {
            const host = render('PR #5 vs https://github.com/zed/lib/pull/4', false);
            expect(chips(host)).to.deep.equal(['zed/lib#4']);
            expect(host.textContent).to.contain('PR #5');
        });

        it('leaves code, inline code, headings and links alone', () => {
            const host = render([
                '# Title #12',
                '',
                'Run `git show #12` now and [see #12](https://example.com/x).',
                '',
                '```',
                'PR #12',
                '```',
                '',
                'The issue #7 is separate.',
            ].join('\n'));
            expect(chips(host)).to.deep.equal([]);
        });

        it('is idempotent on an already decorated block', () => {
            const host = render('See PR #1.');
            decorateTranscriptPullRequestChips(host, repo);
            expect(chips(host)).to.deep.equal(['#1']);
        });

        it('reads the pull request back from a chip', () => {
            const host = render('PR #117');
            const label = host.querySelector('.qaap-transcript-pr-chip-label');
            expect(readTranscriptPullRequestChip(label)).to.deep.equal({
                owner: 'acme', repo: 'app', number: 117, url: 'https://github.com/acme/app/pull/117',
            });
            expect(readTranscriptPullRequestChip(document.createElement('a'))).to.equal(undefined);
        });
    });

    describe('click wiring in the transcript markdown', () => {
        function createUi(bridge: { openPullRequestInPanel?: (ref: WorkHubTranscriptPullRequestRef) => boolean }): {
            ui: MobileProjectsTranscriptMessagesContentUi; host: HTMLElement;
        } {
            const ui = new MobileProjectsTranscriptMessagesContentUi({
                transcriptMarkdownIt: md,
                transcriptOpenProject: { id: 'p', github: { owner: 'acme', name: 'app' } },
            } as never, { resolveShellProject: () => undefined, ...bridge } as never);
            const host = document.createElement('div');
            document.body.append(host);
            (ui as unknown as { renderTranscriptMarkdownSync(h: HTMLElement, c: string): void })
                .renderTranscriptMarkdownSync(host, 'Merged in PR #117 today.');
            return { ui, host };
        }

        afterEach(() => {
            document.body.innerHTML = '';
        });

        it('settled markdown gets chips and clicking one calls the bridge with that pull request', () => {
            const calls: WorkHubTranscriptPullRequestRef[] = [];
            const { host } = createUi({ openPullRequestInPanel: ref => { calls.push(ref); return true; } });
            const label = host.querySelector<HTMLElement>('.qaap-transcript-pr-chip-label')!;
            expect(label.textContent).to.equal('#117');
            const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
            label.dispatchEvent(event);
            expect(calls).to.deep.equal([{ owner: 'acme', repo: 'app', number: 117, url: 'https://github.com/acme/app/pull/117' }]);
            expect(event.defaultPrevented).to.equal(true);
        });

        it('falls back to the GitHub page when the bridge cannot show it', () => {
            const { host } = createUi({ openPullRequestInPanel: () => false });
            const opened: string[] = [];
            const originalOpen = window.open;
            window.open = ((url: string) => { opened.push(url); return null; }) as typeof window.open;
            try {
                host.querySelector<HTMLElement>('.qaap-transcript-pr-chip')!
                    .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
            } finally {
                window.open = originalOpen;
            }
            expect(opened).to.deep.equal(['https://github.com/acme/app/pull/117']);
        });
    });
});
