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

        it('shows staged and unstaged files, not resolved, tree dirty', () => {
            const sel = selectComposerPillChanges([unstaged, staged], false, false);
            expect(sel.hidden).to.equal(false);
            expect(sel.resolved).to.equal(false);
            expect(sel.clean).to.equal(false);
            expect(sel.files).to.deep.equal([unstaged, staged]);
        });

        it('hides the Changes pill once every change is staged (Accept), still committable for Commit', () => {
            const sel = selectComposerPillChanges([staged], false, false);
            // Accept resolved the review — the Changes pill drops, but the staged files stay committable
            // (clean === false) so the separate Commit button remains.
            expect(sel.hidden).to.equal(true);
            expect(sel.resolved).to.equal(true);
            expect(sel.clean).to.equal(false);
        });

        it('hides + resolved + clean on an empty tree (Discard leaves nothing to commit)', () => {
            const sel = selectComposerPillChanges([], false, false);
            expect(sel.hidden).to.equal(true);
            expect(sel.resolved).to.equal(true);
            expect(sel.clean).to.equal(true);
        });

        it('keeps the pill hidden and preserves the clean latch while the snapshot is absent', () => {
            const sel = selectComposerPillChanges(undefined, true, true);
            expect(sel.hidden).to.equal(true);
            expect(sel.resolved).to.equal(true);
            expect(sel.clean).to.equal(true);
        });

        it('preserves a dirty latch while the snapshot is absent (staged, resolved, still committable)', () => {
            const sel = selectComposerPillChanges(undefined, true, false);
            expect(sel.hidden).to.equal(true);
            expect(sel.resolved).to.equal(true);
            expect(sel.clean).to.equal(false);
        });

        it('falls back to the transcript view when no snapshot exists and nothing is resolved', () => {
            const sel = selectComposerPillChanges(undefined, false, false);
            expect(sel.hidden).to.equal(false);
            expect(sel.resolved).to.equal(false);
            expect(sel.files).to.equal(undefined);
        });

        it('clears resolved and marks dirty once a genuinely new unstaged change appears', () => {
            const sel = selectComposerPillChanges([unstaged], true, true);
            expect(sel.hidden).to.equal(false);
            expect(sel.resolved).to.equal(false);
            expect(sel.clean).to.equal(false);
            expect(sel.files).to.deep.equal([unstaged]);
        });

        // Regression: pill must not reappear after Accept/Discard when the snapshot is
        // momentarily absent (e.g. refreshComposerActivityGitFilesIfNeeded deleted it
        // before the re-fetch resolves).  Both latches were intentionally set by the
        // action and must survive the gap.
        it('Accept scenario: resolved+dirty latch hides pill even while snapshot is absent', () => {
            // All files staged (Accept all) → resolved=true, clean=false.
            const afterAccept = selectComposerPillChanges([staged], false, false);
            expect(afterAccept.hidden).to.equal(true);
            expect(afterAccept.resolved).to.equal(true);
            expect(afterAccept.clean).to.equal(false);

            // Snapshot temporarily absent — pill must stay hidden via the resolved latch.
            const gap = selectComposerPillChanges(undefined, afterAccept.resolved, afterAccept.clean);
            expect(gap.hidden).to.equal(true);
            expect(gap.resolved).to.equal(true);
            expect(gap.clean).to.equal(false);
        });

        it('Discard scenario: resolved+clean latch hides pill even while snapshot is absent', () => {
            // Tree cleaned (Discard all) → resolved=true, clean=true.
            const afterDiscard = selectComposerPillChanges([], false, false);
            expect(afterDiscard.hidden).to.equal(true);
            expect(afterDiscard.resolved).to.equal(true);
            expect(afterDiscard.clean).to.equal(true);

            // Snapshot temporarily absent — pill must stay hidden, Commit also gone.
            const gap = selectComposerPillChanges(undefined, afterDiscard.resolved, afterDiscard.clean);
            expect(gap.hidden).to.equal(true);
            expect(gap.resolved).to.equal(true);
            expect(gap.clean).to.equal(true);
        });

        it('new agent edits reset both latches once a real unstaged file appears (pill resurfaces)', () => {
            // Simulate: user Accept/Discarded, then agent writes new files.
            const afterNewEdit = selectComposerPillChanges([unstaged], true, true);
            expect(afterNewEdit.hidden).to.equal(false);
            expect(afterNewEdit.resolved).to.equal(false);
            expect(afterNewEdit.clean).to.equal(false);
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

        it('keeps Accept/Discard reachable even while the agent is (or looks) still working', () => {
            // Regression: a stale agentWorking signal after a finished turn (backend idle, composer
            // summary/DOM lagging) must not lock the user out of managing changes already on disk.
            const workingHost = renderStickyComposerChangesPill({
                diffStats: { added: 3, removed: 1 },
                onReview: () => undefined,
                onKeepAll: () => undefined,
                onUndoAll: () => undefined,
                agentWorking: true,
            });
            document.body.append(workingHost!);
            expect(workingHost!.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-menu')!.disabled)
                .to.equal(false);

            // A running bulk Accept/Discard is the one thing that still disables the menu.
            const bulkBusyHost = renderStickyComposerChangesPill({
                diffStats: { added: 3, removed: 1 },
                onReview: () => undefined,
                onKeepAll: () => undefined,
                onUndoAll: () => undefined,
                changedFilesBulkBusy: true,
            });
            document.body.append(bulkBusyHost!);
            expect(bulkBusyHost!.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-menu')!.disabled)
                .to.equal(true);
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
                hasCommittableChanges: true,
            });
            document.body.append(host!);

            const commitBtn = host!.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-commit-btn');
            expect(commitBtn).to.exist;
            expect(commitBtn!.textContent).to.equal('Commit');
            commitBtn!.click();
            expect(actions).to.deep.equal(['commit']);

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
                'Commit & Push',
                'Commit & Create PR',
            ]);
            items[0].click();
            expect(actions).to.deep.equal(['commit', 'create-branch-commit']);
            expect(dropdown!.hidden).to.equal(true);
        });

        it('portals the commit menu to <body> while open so scroll containers cannot clip it', () => {
            const host = renderStickyComposerChangesPill({
                diffStats: { added: 1, removed: 0 },
                onReview: () => undefined,
                onCommitAction: () => undefined,
                hasCommittableChanges: true,
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
            expect(nextActions.map(action => action.textContent)).to.deep.equal(['View Preview']);
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
                hasCommittableChanges: true,
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
                hasCommittableChanges: true,
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
            expect(nextActions.map(a => a.textContent)).to.deep.equal(['View Preview']);
        });

        // Regression tests for the Accept/Discard pill-resurrection bug:
        // After the action the git snapshot is empty (or all-staged). The Changes group
        // (changesGroup) must disappear immediately; the rendering layer must not fall back
        // to transcript-derived stats while the snapshot is briefly absent.
        it('hides Changes group after Accept (all staged) even when stats were previously shown', () => {
            // Before Accept: pill shows with stats
            const before = renderStickyComposerChangesPill({
                changedFiles: [{ path: 'a.ts', kind: 'edited', added: 3, removed: 1 }],
                diffStats: { added: 3, removed: 1 },
                onReview: () => undefined,
                onKeepAll: () => undefined,
                onUndoAll: () => undefined,
                onCommitAction: () => undefined,
                hasCommittableChanges: true,
                hasFileActivity: true,
            });
            expect(before!.querySelector('.theia-mobile-sticky-composer-changes-group')).to.exist;

            // After Accept: changedFiles=[] (snapshot has staged files, but no unresolved ones),
            // hasCommittableChanges=true (staged files remain). Changes group must be gone.
            const after = renderStickyComposerChangesPill({
                changedFiles: [],
                diffStats: undefined,
                onReview: () => undefined,
                onKeepAll: () => undefined,
                onUndoAll: () => undefined,
                onCommitAction: () => undefined,
                hasCommittableChanges: true,
                hasFileActivity: true,
            });
            expect(after).to.exist; // pill host stays (Commit button remains)
            document.body.append(after!);
            expect(after!.querySelector('.theia-mobile-sticky-composer-changes-group')).to.equal(null,
                'Changes group must not render when there are no unresolved changes (Accept resolved them)');
            expect(after!.querySelector('.theia-mobile-sticky-composer-commit-group')).to.exist;
        });

        it('hides the whole Changes pill host after Discard (clean tree, no preview)', () => {
            // After Discard: changedFiles=[], hasCommittableChanges=false, no preview.
            const after = renderStickyComposerChangesPill({
                changedFiles: [],
                diffStats: undefined,
                onReview: () => undefined,
                onCommitAction: () => undefined,
                hasCommittableChanges: false,
                hasFileActivity: true,
            });
            expect(after).to.equal(undefined,
                'Pill host must be removed entirely after Discard leaves a clean tree with nothing to commit');
        });

        it('hides the whole row when the agent has no file activity, no changes, nothing to commit', () => {
            const host = renderStickyComposerChangesPill({
                onReview: () => undefined,
                onCommitAction: () => undefined,
                onRunApp: () => undefined,
            });
            expect(host).to.equal(undefined);
        });

        it('hides the whole row after commit (clean tree, hasFileActivity, no preview or run)', () => {
            // After Commit & Push the git snapshot is [], hasCommittableChanges=false.
            // The row must vanish entirely — not linger as an empty pill host.
            const host = renderStickyComposerChangesPill({
                hasFileActivity: true,
                hasCommittableChanges: false,
                onReview: () => undefined,
                onCommitAction: () => undefined,
                // no onOpenPreview, no onRunApp
            });
            expect(host).to.equal(undefined);
        });

        it('keeps Open preview after commit when the project has a live preview URL', () => {
            const host = renderStickyComposerChangesPill({
                hasFileActivity: true,
                hasCommittableChanges: false,
                onReview: () => undefined,
                onCommitAction: () => undefined,
                onOpenPreview: () => undefined,
            });
            expect(host).to.exist;
            document.body.append(host!);
            // Changes group and Commit button must be gone…
            expect(host!.querySelector('.theia-mobile-sticky-composer-changes-group')).to.equal(null);
            expect(host!.querySelector('.theia-mobile-sticky-composer-commit-group')).to.equal(null);
            // …but Open preview remains.
            const nextActions = Array.from(host!.querySelectorAll<HTMLButtonElement>('.theia-mobile-sticky-composer-next-action'));
            expect(nextActions.map(a => a.textContent)).to.deep.equal(['View Preview']);
        });

        it('drops the Commit button once the tree is clean (Discard), keeping the preview', () => {
            const host = renderStickyComposerChangesPill({
                hasFileActivity: true,
                hasCommittableChanges: false,
                onReview: () => undefined,
                onCommitAction: () => undefined,
                onOpenPreview: () => undefined,
            });
            expect(host).to.exist;
            document.body.append(host!);

            expect(host!.querySelector('.theia-mobile-sticky-composer-changes-group')).to.equal(null);
            expect(host!.querySelector('.theia-mobile-sticky-composer-commit-group')).to.equal(null);
            const nextActions = Array.from(host!.querySelectorAll<HTMLButtonElement>('.theia-mobile-sticky-composer-next-action'));
            expect(nextActions.map(a => a.textContent)).to.deep.equal(['View Preview']);
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

        it('patchStickyComposerActivityStack returns false when text changes to force a safe re-render', () => {
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

            // When any item's text differs from the entry at that position, the
            // patch returns false so the caller does a full replaceWith — this
            // prevents DOM elements from staying in the old physical order on
            // reorder, or breaking per-item event bindings on edit.
            expect(patchStickyComposerActivityStack(stack!, {
                queueEntries: [{ draft: 'second follow up' }],
                queueExpanded: true,
            })).to.equal(false);
        });

        it('patchStickyComposerActivityStack returns true when nothing changed (same text, same order)', () => {
            const stack = renderStickyComposerActivityStack({
                queueEntries: [{ draft: 'first' }, { draft: 'second' }],
                queueExpanded: true,
            });
            document.body.append(stack!);

            expect(patchStickyComposerActivityStack(stack!, {
                queueEntries: [{ draft: 'first' }, { draft: 'second' }],
                queueExpanded: true,
            })).to.equal(true);
        });

        it('exposes Send now on every queued message', () => {
            const sent: number[] = [];
            const stack = renderStickyComposerActivityStack({
                queueEntries: [{ draft: 'first' }, { draft: 'second' }, { draft: 'third' }],
                queueExpanded: true,
                onQueueSendNow: index => { sent.push(index); },
            });
            expect(stack).to.exist;
            expect(stack!.classList.contains('theia-mod-queue-popover')).to.equal(true);
            const sendButtons = Array.from(stack!.querySelectorAll<HTMLButtonElement>(
                '.theia-mobile-sticky-composer-queue-action[aria-label="Send now"]',
            ));
            expect(sendButtons).to.have.length(3);
            expect(stack!.querySelector('.codicon-arrow-up')).to.equal(null);
            sendButtons[1].click();
            expect(sent).to.deep.equal([1]);
        });

        it('labels the send action "Run in parallel" while the agent is working', () => {
            const stack = renderStickyComposerActivityStack({
                queueEntries: [{ draft: 'first' }],
                queueExpanded: true,
                agentWorking: true,
                onQueueSendNow: () => { },
            });
            expect(stack!.querySelector('.theia-mobile-sticky-composer-queue-action[aria-label="Run in parallel"]')).to.exist;
            expect(stack!.querySelector('.theia-mobile-sticky-composer-queue-action[aria-label="Send now"]')).to.equal(null);
        });

        it('repaints the send action label when the agent settles', () => {
            const working = { queueEntries: [{ draft: 'first' }], queueExpanded: true, agentWorking: true };
            const idle = { queueEntries: [{ draft: 'first' }], queueExpanded: true, agentWorking: false };
            // The label is part of the fingerprint, so a working -> idle flip is not skipped as a no-op.
            expect(buildStickyComposerActivityStackFingerprint(working))
                .to.not.equal(buildStickyComposerActivityStackFingerprint(idle));

            const stack = renderStickyComposerActivityStack(working);
            document.body.append(stack!);
            expect(patchStickyComposerActivityStack(stack!, idle)).to.equal(true);
            expect(stack!.querySelector('.theia-mobile-sticky-composer-queue-action[aria-label="Send now"]')).to.exist;
        });
    });
});
