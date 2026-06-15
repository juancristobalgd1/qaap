// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    patchStickyComposerChangesPill,
    renderStickyComposerActivityStack,
    renderStickyComposerChangesPill,
    type StickyComposerChangedFileView,
} from './qaap-sticky-composer-activity-stack';
import { readQaapCounterPushDisplayText } from './qaap-counter-push-dom';

describe('qaap-sticky-composer-activity-stack', () => {

    describe('renderStickyComposerChangesPill', () => {
        let disableJSDOM: () => void;

        before(() => {
            disableJSDOM = enableJSDOM();
        });

        after(() => {
            disableJSDOM();
        });

        it('renders a Changes pill that opens review on click', () => {
            let reviewCalled = false;
            const files: StickyComposerChangedFileView[] = [
                { path: 'src/app.ts', kind: 'edited', added: 4, removed: 1 },
                { path: 'docs/readme.md', kind: 'created' },
            ];

            const host = renderStickyComposerChangesPill({
                changedFiles: files,
                diffStats: { added: 5, removed: 1 },
                onReview: () => { reviewCalled = true; },
            });
            expect(host).to.exist;
            document.body.append(host!);

            expect(host!.className).to.equal('theia-mobile-sticky-composer-changes-pill-host');
            const pill = host!.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-changes-pill');
            expect(pill).to.exist;
            expect(pill!.querySelector('.theia-mobile-sticky-composer-changes-pill-label')?.textContent).to.equal('Changes');
            const addedBadge = pill!.querySelector<HTMLElement>('[data-qaap-diff-stat-added]');
            const removedBadge = pill!.querySelector<HTMLElement>('[data-qaap-diff-stat-removed]');
            expect(addedBadge && readQaapCounterPushDisplayText(addedBadge)).to.equal('+5');
            expect(removedBadge && readQaapCounterPushDisplayText(removedBadge)).to.equal('-1');
            expect(host!.querySelector('.theia-mobile-sticky-composer-changed-file-row')).to.equal(null);

            pill!.click();
            expect(reviewCalled).to.equal(true);
        });

        it('shows the Changes pill for stats-only activity before per-file rows are available', () => {
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 12, removed: 3 },
                onReview: () => undefined,
            });
            document.body.append(host!);

            expect(host!.querySelector('.theia-mobile-sticky-composer-changes-pill')).to.exist;
        });

        it('renders Stop beside the Changes pill while the agent is working', () => {
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 2, removed: 0 },
                agentWorking: true,
                onStop: () => undefined,
                onReview: () => undefined,
            });
            document.body.append(host!);

            expect(host!.querySelector('.theia-mobile-sticky-composer-changes-pill')).to.exist;
            expect(host!.querySelector('.theia-mobile-sticky-composer-activity-stop')?.textContent).to.equal('Stop');
        });

        it('renders the commit split-button beside the Changes pill and fires the workflow actions', () => {
            const actions: string[] = [];
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 4, removed: 2 },
                onReview: () => undefined,
                onCommitAction: action => { actions.push(action); },
            });
            document.body.append(host!);

            const commitBtn = host!.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-btn');
            expect(commitBtn).to.exist;
            expect(commitBtn!.textContent).to.equal('Commit & Push');
            commitBtn!.click();
            expect(actions).to.deep.equal(['commit-push']);

            const menuBtn = host!.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-menu');
            const dropdown = host!.querySelector<HTMLElement>('.theia-mobile-sticky-composer-commit-dropdown');
            expect(menuBtn).to.exist;
            expect(dropdown!.hidden).to.equal(true);
            menuBtn!.click();
            expect(dropdown!.hidden).to.equal(false);
            expect(menuBtn!.getAttribute('aria-expanded')).to.equal('true');

            const items = Array.from(dropdown!.querySelectorAll<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-dropdown-item'));
            expect(items.map(item => item.textContent)).to.deep.equal([
                'Create Branch & Commit',
                'Create Branch, Commit & Push',
                'Commit',
                'Commit & Create PR',
            ]);
            items[0].click();
            expect(actions).to.deep.equal(['commit-push', 'create-branch-commit']);
            expect(dropdown!.hidden).to.equal(true);
        });

        it('marks the commit group busy (border beam) and disables its buttons while committing', () => {
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 4, removed: 2 },
                onReview: () => undefined,
                onCommitAction: () => undefined,
                commitBusy: true,
            });
            document.body.append(host!);

            const group = host!.querySelector<HTMLElement>('.theia-mobile-sticky-composer-commit-group');
            expect(group).to.exist;
            expect(group!.classList.contains('theia-mod-busy')).to.equal(true);
            expect(host!.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-btn')!.disabled).to.equal(true);
            expect(host!.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-menu')!.disabled).to.equal(true);
        });

        it('does not render the commit split-button without an onCommitAction handler', () => {
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 1, removed: 0 },
                onReview: () => undefined,
            });
            document.body.append(host!);

            expect(host!.querySelector('.theia-mobile-sticky-composer-commit-group')).to.equal(null);
        });

        it('shows the Changes pill while a file-change tool is in flight before stats land', () => {
            const host = renderStickyComposerChangesPill({
                pendingFileChanges: true,
                agentWorking: true,
                onStop: () => undefined,
                onReview: () => undefined,
            });
            document.body.append(host!);

            expect(host!.querySelector('.theia-mobile-sticky-composer-changes-pill')).to.exist;
            expect(host!.querySelector(`[data-qaap-diff-stat-added]`)).to.equal(null);
            expect(host!.querySelector('.theia-mobile-sticky-composer-activity-stop')?.textContent).to.equal('Stop');
        });

        it('patches diff stats in place for counter push animation', async () => {
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 5, removed: 1 },
                onReview: () => undefined,
            });
            document.body.append(host!);

            const patched = patchStickyComposerChangesPill(host!, {
                diffStats: { added: 12, removed: 3 },
                onReview: () => undefined,
            });
            expect(patched).to.equal(true);
            await new Promise(resolve => window.setTimeout(resolve, 400));
            const addedBadge = host!.querySelector<HTMLElement>('[data-qaap-diff-stat-added]');
            const removedBadge = host!.querySelector<HTMLElement>('[data-qaap-diff-stat-removed]');
            expect(addedBadge && readQaapCounterPushDisplayText(addedBadge)).to.equal('+12');
            expect(removedBadge && readQaapCounterPushDisplayText(removedBadge)).to.equal('-3');
        });

        it('renders Cursor-style flat +N/−N counters on the Changes pill', () => {
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 434, removed: 44 },
                onReview: () => undefined,
            });
            document.body.append(host!);

            const added = host!.querySelector<HTMLElement>('[data-qaap-diff-stat-added]');
            const removed = host!.querySelector<HTMLElement>('[data-qaap-diff-stat-removed]');
            expect(added?.classList.contains('qaap-counter-push-stat')).to.equal(true);
            expect(removed?.classList.contains('qaap-counter-push-stat')).to.equal(true);
            expect(added && readQaapCounterPushDisplayText(added)).to.equal('+434');
            expect(removed && readQaapCounterPushDisplayText(removed)).to.equal('-44');
            expect(host!.querySelector('.theia-mobile-sticky-composer-changes-pill-label')?.textContent).to.equal('Changes');
        });

        it('updates both counters when lines are added then removed', async () => {
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 10, removed: 0 },
                onReview: () => undefined,
            });
            document.body.append(host!);
            expect(host!.querySelector('[data-qaap-diff-stat-removed]')).to.equal(null);

            patchStickyComposerChangesPill(host!, {
                diffStats: { added: 25, removed: 3 },
                onReview: () => undefined,
            });
            await new Promise(resolve => window.setTimeout(resolve, 400));
            const addedBadge = host!.querySelector<HTMLElement>('[data-qaap-diff-stat-added]');
            const removedBadge = host!.querySelector<HTMLElement>('[data-qaap-diff-stat-removed]');
            expect(addedBadge && readQaapCounterPushDisplayText(addedBadge)).to.equal('+25');
            expect(removedBadge && readQaapCounterPushDisplayText(removedBadge)).to.equal('-3');

            patchStickyComposerChangesPill(host!, {
                diffStats: { added: 18, removed: 8 },
                onReview: () => undefined,
            });
            await new Promise(resolve => window.setTimeout(resolve, 400));
            expect(addedBadge && readQaapCounterPushDisplayText(addedBadge)).to.equal('+18');
            expect(removedBadge && readQaapCounterPushDisplayText(removedBadge)).to.equal('-8');
        });
    });

    describe('renderStickyComposerActivityStack queue', () => {
        let disableJSDOM: () => void;

        before(() => {
            disableJSDOM = enableJSDOM();
        });

        after(() => {
            disableJSDOM();
        });

        it('keeps the queue stack separate from the Changes pill', () => {
            const stack = renderStickyComposerActivityStack({
                queueEntries: [{ draft: 'follow up' }],
                changedFiles: [{ path: 'src/main.ts', kind: 'edited', added: 3, removed: 1 }],
                diffStats: { added: 3, removed: 1 },
            });
            expect(stack).to.exist;
            expect(stack!.querySelector('.theia-mobile-sticky-composer-activity-section.theia-mod-queue')).to.exist;
            expect(stack!.querySelector('.theia-mobile-sticky-composer-changes-pill')).to.equal(null);
        });
    });
});
