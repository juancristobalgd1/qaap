// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    buildStickyComposerActivityStackFingerprint,
    buildStickyComposerChangesPillFingerprint,
    patchStickyComposerActivityStack,
    patchStickyComposerChangesPillHost,
    renderStickyComposerActivityStack,
    renderStickyComposerChangesPill,
    selectComposerPillChanges,
    type StickyComposerChangedFileView,
} from './qaap-sticky-composer-activity-stack';

describe('qaap-sticky-composer-activity-stack', () => {

    describe('selectComposerPillChanges', () => {
        const unstaged: StickyComposerChangedFileView = { path: 'a.ts', kind: 'edited', added: 3, removed: 1 };
        const staged: StickyComposerChangedFileView = { path: 'b.ts', kind: 'edited', added: 2, removed: 0, staged: true };

        it('shows only unstaged files and is not resolved', () => {
            const sel = selectComposerPillChanges([unstaged, staged], false);
            expect(sel.hidden).to.equal(false);
            expect(sel.resolved).to.equal(false);
            expect(sel.unstaged).to.deep.equal([unstaged]);
        });

        it('hides and latches resolved once every change is staged (Accept)', () => {
            const sel = selectComposerPillChanges([staged], false);
            expect(sel.hidden).to.equal(true);
            expect(sel.resolved).to.equal(true);
            expect(sel.unstaged).to.equal(undefined);
        });

        it('hides and latches resolved on a clean tree (Discard/commit)', () => {
            const sel = selectComposerPillChanges([], false);
            expect(sel.hidden).to.equal(true);
            expect(sel.resolved).to.equal(true);
        });

        it('keeps the pill hidden while resolved and the snapshot is momentarily absent', () => {
            const sel = selectComposerPillChanges(undefined, true);
            expect(sel.hidden).to.equal(true);
            expect(sel.resolved).to.equal(true);
        });

        it('falls back to the transcript view when no snapshot exists and nothing is resolved', () => {
            const sel = selectComposerPillChanges(undefined, false);
            expect(sel.hidden).to.equal(false);
            expect(sel.resolved).to.equal(false);
            expect(sel.unstaged).to.equal(undefined);
        });

        it('clears resolved once a genuinely new unstaged change appears', () => {
            const sel = selectComposerPillChanges([unstaged], true);
            expect(sel.hidden).to.equal(false);
            expect(sel.resolved).to.equal(false);
            expect(sel.unstaged).to.deep.equal([unstaged]);
        });
    });

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
            expect(pill!.querySelector('.theia-mobile-agent-diff-stat.theia-mod-added')?.textContent).to.equal('+5');
            expect(pill!.querySelector('.theia-mobile-agent-diff-stat.theia-mod-removed')?.textContent).to.equal('-1');
            expect(host!.querySelector('.theia-mobile-sticky-composer-changed-file-row')).to.equal(null);

            pill!.click();
            expect(reviewCalled).to.equal(true);
        });

        it('renders the Changes split-button menu with Accept and Discard actions', () => {
            const actions: string[] = [];
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 3, removed: 1 },
                onReview: () => undefined,
                onKeepAll: () => { actions.push('accept'); },
                onUndoAll: () => { actions.push('discard'); },
            });
            document.body.append(host!);

            const group = host!.querySelector<HTMLElement>('.theia-mobile-sticky-composer-changes-group');
            expect(group).to.exist;
            const menuBtn = group!.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-menu');
            expect(menuBtn).to.exist;
            const dropdown = group!.querySelector<HTMLElement>('.theia-mobile-sticky-composer-commit-dropdown');
            expect(dropdown!.hidden).to.equal(true);

            menuBtn!.click();
            expect(dropdown!.hidden).to.equal(false);
            const items = Array.from(dropdown!.querySelectorAll<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-dropdown-item'));
            expect(items.map(item => item.textContent)).to.deep.equal(['Accept', 'Discard']);

            items[0].click();
            expect(actions).to.deep.equal(['accept']);
            expect(dropdown!.hidden).to.equal(true);

            menuBtn!.click();
            items[1].click();
            expect(actions).to.deep.equal(['accept', 'discard']);
        });

        it('renders no Changes menu chevron without Accept/Discard handlers', () => {
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 3, removed: 1 },
                onReview: () => undefined,
            });
            document.body.append(host!);

            const group = host!.querySelector<HTMLElement>('.theia-mobile-sticky-composer-changes-group');
            expect(group).to.exist;
            expect(group!.querySelector('.theia-mobile-sticky-composer-commit-menu')).to.equal(null);
        });

        it('shows the Changes pill for stats-only activity before per-file rows are available', () => {
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 12, removed: 3 },
                onReview: () => undefined,
            });
            document.body.append(host!);

            expect(host!.querySelector('.theia-mobile-sticky-composer-changes-pill')).to.exist;
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

        it('portals the commit menu to <body> while open so scroll containers cannot clip it', () => {
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 1, removed: 0 },
                onReview: () => undefined,
                onCommitAction: () => undefined,
            });
            document.body.append(host!);

            const menuBtn = host!.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-menu');
            const dropdown = host!.querySelector<HTMLElement>('.theia-mobile-sticky-composer-commit-dropdown');
            const menuWrap = dropdown!.parentElement;

            menuBtn!.click();
            expect(dropdown!.hidden).to.equal(false);
            expect(dropdown!.parentElement).to.equal(document.body);
            expect(dropdown!.classList.contains('theia-mod-portal')).to.equal(true);

            menuBtn!.click();
            expect(dropdown!.hidden).to.equal(true);
            expect(dropdown!.parentElement).to.equal(menuWrap);
            expect(dropdown!.classList.contains('theia-mod-portal')).to.equal(false);
        });

        it('shows only Open preview when the app is already up (preview URL available)', () => {
            const actions: string[] = [];
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 10, removed: 1 },
                onReview: () => undefined,
                onRunApp: () => { actions.push('run'); },
                onOpenPreview: () => { actions.push('preview'); },
            });
            document.body.append(host!);

            const nextActions = Array.from(host!.querySelectorAll<HTMLButtonElement>('.theia-mobile-sticky-composer-next-action'));
            expect(nextActions.map(action => action.textContent)).to.deep.equal(['Open preview']);
            nextActions[0].click();
            expect(actions).to.deep.equal(['preview']);
        });

        it('shows only Run app while no preview URL exists yet', () => {
            const actions: string[] = [];
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 10, removed: 1 },
                onReview: () => undefined,
                onRunApp: () => { actions.push('run'); },
            });
            document.body.append(host!);

            const nextActions = Array.from(host!.querySelectorAll<HTMLButtonElement>('.theia-mobile-sticky-composer-next-action'));
            expect(nextActions.map(action => action.textContent)).to.deep.equal(['Run app']);
            nextActions[0].click();
            expect(actions).to.deep.equal(['run']);
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

        it('keeps Commit and preview after the review is resolved, dropping only the Changes group', () => {
            // Accept/Discard resolved the review (no changed files/stats) but the agent did edit files.
            const host = renderStickyComposerChangesPill({
                hasFileActivity: true,
                onReview: () => undefined,
                onKeepAll: () => undefined,
                onUndoAll: () => undefined,
                onCommitAction: () => undefined,
                onOpenPreview: () => undefined,
            });
            expect(host).to.exist;
            document.body.append(host!);

            // The review "Changes" group is gone…
            expect(host!.querySelector('.theia-mobile-sticky-composer-changes-group')).to.equal(null);
            expect(host!.querySelector('.theia-mobile-sticky-composer-changes-pill')).to.equal(null);
            // …but Commit & Push and Open preview remain.
            expect(host!.querySelector('.theia-mobile-sticky-composer-commit-group')).to.exist;
            const nextActions = Array.from(host!.querySelectorAll<HTMLButtonElement>('.theia-mobile-sticky-composer-next-action'));
            expect(nextActions.map(a => a.textContent)).to.deep.equal(['Open preview']);
        });

        it('hides the whole row when the agent has no file activity and no changes', () => {
            const host = renderStickyComposerChangesPill({
                onReview: () => undefined,
                onCommitAction: () => undefined,
                onRunApp: () => undefined,
            });
            expect(host).to.equal(undefined);
        });

        it('patchStickyComposerChangesPillHost updates stats without replacing the pill node', () => {
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 648, removed: 384 },
                onReview: () => undefined,
            });
            document.body.append(host!);
            const pill = host!.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-changes-pill');
            expect(pill).to.exist;

            const beforeFingerprint = buildStickyComposerChangesPillFingerprint({
                diffStats: { added: 648, removed: 384 },
                onReview: () => undefined,
            });
            const afterFingerprint = buildStickyComposerChangesPillFingerprint({
                diffStats: { added: 650, removed: 384 },
                onReview: () => undefined,
            });
            expect(beforeFingerprint).to.not.equal(afterFingerprint);

            expect(patchStickyComposerChangesPillHost(host!, {
                diffStats: { added: 650, removed: 384 },
                onReview: () => undefined,
            })).to.equal(true);
            expect(host!.querySelector('.theia-mobile-sticky-composer-changes-pill')).to.equal(pill);
            expect(pill!.querySelector('.theia-mobile-agent-diff-stat.theia-mod-added')?.textContent).to.equal('+650');
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

        it('patchStickyComposerActivityStack updates queue text without replacing the stack node', () => {
            const stack = renderStickyComposerActivityStack({
                queueEntries: [{ draft: 'first follow up' }],
                queueExpanded: true,
            });
            document.body.append(stack!);
            const beforeFingerprint = buildStickyComposerActivityStackFingerprint({
                queueEntries: [{ draft: 'first follow up' }],
                queueExpanded: true,
            });
            const afterFingerprint = buildStickyComposerActivityStackFingerprint({
                queueEntries: [{ draft: 'second follow up' }],
                queueExpanded: true,
            });
            expect(beforeFingerprint).to.not.equal(afterFingerprint);

            expect(patchStickyComposerActivityStack(stack!, {
                queueEntries: [{ draft: 'second follow up' }],
                queueExpanded: true,
            })).to.equal(true);
            expect(stack!.querySelector('.theia-mobile-sticky-composer-queue-text')?.textContent).to.equal('second follow up');
        });
    });
});
