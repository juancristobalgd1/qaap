// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { WorkHubTeamMember } from '../common/qaap-work-hub-team';
import {
    WORKING_CONTROL_CLASS,
    WORKING_DETAIL_PANEL_CLASS,
    WORKING_EXPAND_CLIP_CLASS,
    clearWorkingPillStopAllSuppression,
    closeWorkingAgentsPopover,
    flattenWorkingAgentsTree,
    getWorkingAgentsDetailMemberId,
    isWorkingAgentsExpandPinnedOpen,
    isWorkingAgentsExpandSessionOpen,
    isWorkingAgentsPopoverOpen,
    openWorkingAgentsPopover,
    parkWorkingControlFromAncestor,
    renderWorkingAgentsPopoverPanel,
    resolveWorkingAgentStatusLabel,
    restoreWorkingAgentsExpandIfNeeded,
    syncWorkingAgentsExpandContent,
    transferWorkingControlToHost,
} from './qaap-sticky-composer-working-agents-popover';

describe('qaap-sticky-composer-working-agents-popover', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
        // Node's AbortSignal is incompatible with jsdom addEventListener({ signal }).
        globalThis.AbortController = window.AbortController;
        window.requestAnimationFrame = callback => {
            callback(0);
            return 1;
        };
        window.cancelAnimationFrame = () => undefined;
    });

    after(() => {
        disableJSDOM();
    });

    beforeEach(() => {
        closeWorkingAgentsPopover(true);
        clearWorkingPillStopAllSuppression();
        document.body.replaceChildren();
    });

    afterEach(() => {
        closeWorkingAgentsPopover(true);
        clearWorkingPillStopAllSuppression();
        document.body.replaceChildren();
    });

    function member(partial: Partial<WorkHubTeamMember> & Pick<WorkHubTeamMember, 'id' | 'title'>): WorkHubTeamMember {
        return {
            kind: 'conversation',
            projectName: 'Demo',
            cwd: '/srv/demo',
            agentId: 'qaiq',
            state: 'streaming',
            childCount: 0,
            createdAt: 1,
            updatedAt: 2,
            conversationId: partial.id,
            ...partial,
        };
    }

    it('flattens parent and nested subagent rows with depth', () => {
        const parent = member({ id: 'parent', title: 'Working pill agents popover', childCount: 1 });
        const child = member({
            id: 'child',
            title: 'Explore working agents popover',
            kind: 'subtask',
            parentId: 'parent',
            state: 'running',
            activityLabel: 'Reading popover and team data',
        });
        const entries = flattenWorkingAgentsTree([parent, child]);
        expect(entries.map(entry => ({ id: entry.member.id, depth: entry.depth }))).to.deep.equal([
            { id: 'parent', depth: 0 },
            { id: 'child', depth: 1 },
        ]);
    });

    it('keeps multiple top-level agents flat and nests only their subagents', () => {
        // Matches Cursor "3 Working" reference: parent A + nested child + parent B.
        const parentA = member({
            id: 'a',
            title: 'Files icons size and overflow',
            childCount: 1,
            activityLabel: 'Locating view picker mount',
        });
        const child = member({
            id: 'a-child',
            title: 'Explore files header widgets',
            kind: 'subtask',
            parentId: 'a',
            state: 'running',
            activityLabel: 'Redactando informe de implementacion',
        });
        const parentB = member({
            id: 'b',
            title: 'Working popover subagent hierarchy',
            activityLabel: 'Building browser preview',
        });
        const entries = flattenWorkingAgentsTree([parentA, child, parentB]);
        expect(entries.map(entry => ({ id: entry.member.id, depth: entry.depth }))).to.deep.equal([
            { id: 'a', depth: 0 },
            { id: 'a-child', depth: 1 },
            { id: 'b', depth: 0 },
        ]);
        const panel = renderWorkingAgentsPopoverPanel({
            entries,
            onStopAll: () => undefined,
            onClose: () => undefined,
            onSelect: () => undefined,
        });
        expect(panel.querySelector('.qaap-working-agents-popover-title')?.textContent).to.equal('3 Working');
        const rows = panel.querySelectorAll('.qaap-working-agents-popover-row');
        expect(rows).to.have.length(3);
        expect(rows[0].classList.contains('theia-mod-child')).to.equal(false);
        expect(rows[0].querySelector('.theia-mod-parent-icon')).to.not.equal(null);
        expect(rows[1].classList.contains('theia-mod-child')).to.equal(true);
        expect(rows[1].querySelector('.theia-mod-child-icon')).to.not.equal(null);
        expect(rows[2].classList.contains('theia-mod-child')).to.equal(false);
        expect(rows[2].querySelector('.theia-mod-parent-icon')).to.not.equal(null);
    });

    it('renders header Stop All / close and indented child rows', () => {
        const parent = member({ id: 'parent', title: 'Parent task', activityLabel: 'Building' });
        const child = member({
            id: 'child',
            title: 'Child explore',
            parentId: 'parent',
            kind: 'subtask',
            state: 'running',
            activityLabel: 'Reading files',
        });
        let stopped = false;
        let closed = false;
        let selected: string | undefined;
        const panel = renderWorkingAgentsPopoverPanel({
            entries: flattenWorkingAgentsTree([parent, child]),
            onStopAll: () => { stopped = true; },
            onClose: () => { closed = true; },
            onSelect: m => { selected = m.id; },
        });
        expect(panel.querySelector('.qaap-working-agents-popover-title')?.textContent).to.equal('2 Working');
        panel.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-stop-all')?.click();
        expect(stopped).to.equal(true);
        panel.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-close')?.click();
        expect(closed).to.equal(true);

        const rows = panel.querySelectorAll('.qaap-working-agents-popover-row');
        expect(rows).to.have.length(2);
        expect(rows[1].classList.contains('theia-mod-child')).to.equal(true);
        const childStatus = rows[1].querySelector('.qaap-working-agents-popover-row-status');
        expect(childStatus?.textContent).to.equal('Reading files');
        expect(childStatus?.classList.contains('theia-mod-shimmer')).to.equal(true);
        expect(rows[0].querySelector('.qaap-working-agents-popover-row-status')?.classList.contains('theia-mod-shimmer'))
            .to.equal(true);
        (rows[0] as HTMLButtonElement).click();
        expect(selected).to.equal('parent');
    });

    it('opens detail on row click without collapsing the Working expand', () => {
        const rowHost = document.createElement('div');
        rowHost.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const anchor = document.createElement('button');
        anchor.className = 'theia-mobile-sticky-composer-working-pill';
        rowHost.append(anchor);
        document.body.append(rowHost);
        const parent = member({
            id: 'parent',
            title: 'Review the latest pull request: summarize changes',
            activityLabel: 'Summarizing diff',
            childCount: 1,
        });
        const child = member({
            id: 'child',
            title: 'Explore PR files',
            parentId: 'parent',
            kind: 'subtask',
            state: 'running',
            activityLabel: 'Reading files',
        });
        let openedSession: string | undefined;
        openWorkingAgentsPopover({
            anchor,
            members: [parent, child],
            onSelect: m => { openedSession = m.id; },
            onStopAll: () => undefined,
        });
        const shell = anchor.parentElement;
        expect(shell?.classList.contains('theia-mod-expanded')).to.equal(true);
        const listRow = document.querySelector<HTMLButtonElement>(
            '.qaap-working-agents-popover-row[data-member-id="parent"]',
        );
        expect(listRow).to.not.equal(null);
        listRow!.click();
        expect(shell?.classList.contains('theia-mod-expanded')).to.equal(true);
        expect(isWorkingAgentsPopoverOpen(anchor)).to.equal(true);
        expect(getWorkingAgentsDetailMemberId()).to.equal('parent');
        const detail = document.querySelector(`.${WORKING_DETAIL_PANEL_CLASS}`);
        expect(detail).to.not.equal(null);
        expect(detail?.textContent).to.contain('Review the latest pull request');
        expect(detail?.textContent).to.contain('Summarizing diff');
        expect(detail?.textContent).to.contain('1 Subagents');
        expect(detail?.textContent).to.contain('Explore PR files');
        expect(openedSession).to.equal(undefined);
        detail?.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-back')?.click();
        expect(getWorkingAgentsDetailMemberId()).to.equal(undefined);
        expect(document.querySelector(`.${WORKING_DETAIL_PANEL_CLASS}`)).to.equal(null);
        expect(shell?.classList.contains('theia-mod-expanded')).to.equal(true);
        expect(document.querySelector('.qaap-working-agents-popover-title')?.textContent).to.equal('2 Working');
    });

    it('falls back status label to Working when activity is empty', () => {
        expect(resolveWorkingAgentStatusLabel(member({ id: 'a', title: 'T' }))).to.equal('Working');
    });

    it('shimmers live status loaders and syncs activity text while expanded', () => {
        const row = document.createElement('div');
        row.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const anchor = document.createElement('button');
        anchor.className = 'theia-mobile-sticky-composer-working-pill';
        row.append(anchor);
        document.body.append(row);
        const parent = member({ id: 'p1', title: 'Main', activityLabel: 'Locating mount' });
        openWorkingAgentsPopover({
            anchor,
            members: [parent],
            onSelect: () => undefined,
            onStopAll: () => undefined,
        });
        const status = document.querySelector('.qaap-working-agents-popover-row-status');
        expect(status?.textContent).to.equal('Locating mount');
        expect(status?.classList.contains('theia-mod-shimmer')).to.equal(true);
        syncWorkingAgentsExpandContent([
            member({ id: 'p1', title: 'Main', activityLabel: 'Building browser preview' }),
        ]);
        expect(status?.textContent).to.equal('Building browser preview');
        expect(status?.classList.contains('theia-mod-shimmer')).to.equal(true);
    });

    it('expands the Working pill in place and toggles closed', () => {
        const row = document.createElement('div');
        row.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const anchor = document.createElement('button');
        anchor.className = 'theia-mobile-sticky-composer-working-pill';
        row.append(anchor);
        document.body.append(row);
        const parent = member({ id: 'p1', title: 'Main' });
        openWorkingAgentsPopover({
            anchor,
            members: [parent],
            onSelect: () => undefined,
            onStopAll: () => undefined,
        });
        const shell = anchor.parentElement;
        expect(shell?.classList.contains(WORKING_CONTROL_CLASS)).to.equal(true);
        expect(shell?.classList.contains('theia-mod-expanded')).to.equal(true);
        const clip = shell?.querySelector(`.${WORKING_EXPAND_CLIP_CLASS}`);
        expect(clip).to.not.equal(null);
        expect(clip?.classList.contains('theia-mod-open')).to.equal(true);
        expect(document.querySelector('.qaap-sticky-composer-sheet-popover.theia-mod-working-agents')).to.equal(null);
        expect(anchor.getAttribute('aria-expanded')).to.equal('true');
        expect(clip?.textContent).to.contain('1 Working');
        expect(clip?.textContent).to.contain('Stop All');
        expect(clip?.textContent).to.contain('Main');
        openWorkingAgentsPopover({
            anchor,
            members: [parent],
            onSelect: () => undefined,
            onStopAll: () => undefined,
        });
        expect(shell?.classList.contains('theia-mod-expanded')).to.equal(false);
        expect(anchor.getAttribute('aria-expanded')).to.equal('false');
    });

    it('preserves expand session and detail across host remount', () => {
        const rowHost = document.createElement('div');
        rowHost.className = 'theia-mobile-sticky-composer-changes-pill-host';
        const row = document.createElement('div');
        row.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const anchor = document.createElement('button');
        anchor.className = 'theia-mobile-sticky-composer-working-pill';
        row.append(anchor);
        rowHost.append(row);
        document.body.append(rowHost);

        const parent = member({
            id: 'parent',
            title: 'Review the latest pull request',
            activityLabel: 'Summarizing diff',
        });
        openWorkingAgentsPopover({
            anchor,
            members: [parent],
            onSelect: () => undefined,
            onStopAll: () => undefined,
        });
        document.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-row')?.click();
        expect(getWorkingAgentsDetailMemberId()).to.equal('parent');
        const shellBefore = anchor.parentElement;
        expect(shellBefore?.classList.contains('theia-mod-expanded')).to.equal(true);

        const newHost = document.createElement('div');
        newHost.className = 'theia-mobile-sticky-composer-changes-pill-host';
        const newRow = document.createElement('div');
        newRow.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const newAnchor = document.createElement('button');
        newAnchor.className = 'theia-mobile-sticky-composer-working-pill';
        newAnchor.textContent = '1 Working';
        newRow.append(newAnchor);
        newHost.append(newRow);
        document.body.append(newHost);
        rowHost.remove();

        expect(isWorkingAgentsExpandSessionOpen()).to.equal(true);
        expect(getWorkingAgentsDetailMemberId()).to.equal('parent');

        const restored = restoreWorkingAgentsExpandIfNeeded({
            anchor: newAnchor,
            members: [parent],
            onSelect: () => undefined,
            onStopAll: () => undefined,
        });
        expect(restored).to.equal(true);
        expect(isWorkingAgentsExpandSessionOpen()).to.equal(true);
        expect(getWorkingAgentsDetailMemberId()).to.equal('parent');

        const shellAfter = newAnchor.parentElement;
        expect(shellAfter?.classList.contains('theia-mod-expanded')).to.equal(true);
        expect(shellAfter?.classList.contains('theia-mod-detail')).to.equal(true);
        expect(document.querySelector(`.${WORKING_DETAIL_PANEL_CLASS}`)).to.not.equal(null);
        expect(isWorkingAgentsPopoverOpen(newAnchor)).to.equal(true);
    });

    it('keeps detail open across summary/settled idle transition (count → 0)', () => {
        const rowHost = document.createElement('div');
        rowHost.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const anchor = document.createElement('button');
        anchor.className = 'theia-mobile-sticky-composer-working-pill';
        rowHost.append(anchor);
        document.body.append(rowHost);

        const streaming = member({
            id: 'agent-1',
            title: 'Implement Working expand pin',
            state: 'streaming',
            activityLabel: 'Writing summary',
        });
        openWorkingAgentsPopover({
            anchor,
            members: [streaming],
            onSelect: () => undefined,
            onStopAll: () => undefined,
        });
        document.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-row')?.click();
        expect(getWorkingAgentsDetailMemberId()).to.equal('agent-1');
        expect(isWorkingAgentsExpandPinnedOpen()).to.equal(true);

        // Summary/settled: agent flips streaming → idle and working count drops to 0.
        const settled = member({
            id: 'agent-1',
            title: 'Implement Working expand pin',
            state: 'idle',
            activityLabel: undefined,
        });
        syncWorkingAgentsExpandContent([settled]);
        restoreWorkingAgentsExpandIfNeeded({
            anchor,
            members: [settled],
            onSelect: () => undefined,
            onStopAll: () => undefined,
        });

        expect(isWorkingAgentsExpandSessionOpen()).to.equal(true);
        expect(isWorkingAgentsExpandPinnedOpen()).to.equal(true);
        expect(getWorkingAgentsDetailMemberId()).to.equal('agent-1');
        expect(document.querySelector(`.${WORKING_DETAIL_PANEL_CLASS}`)).to.not.equal(null);
        expect(document.querySelector(`.${WORKING_EXPAND_CLIP_CLASS}.theia-mod-open`)).to.not.equal(null);
        expect(document.querySelector(`.${WORKING_CONTROL_CLASS}.theia-mod-expanded`)).to.not.equal(null);
    });

    it('Stop All invokes onStopAll with working members and does not close first', () => {
        const rowHost = document.createElement('div');
        rowHost.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const anchor = document.createElement('button');
        anchor.className = 'theia-mobile-sticky-composer-working-pill';
        rowHost.append(anchor);
        document.body.append(rowHost);

        const parent = member({ id: 'p1', title: 'Main task' });
        const child = member({
            id: 'c1',
            title: 'Subagent',
            parentId: 'p1',
            kind: 'subtask',
            state: 'running',
        });
        let stoppedIds: string[] = [];
        openWorkingAgentsPopover({
            anchor,
            members: [parent, child],
            onSelect: () => undefined,
            onStopAll: working => {
                stoppedIds = working.map(entry => entry.id);
            },
        });
        expect(isWorkingAgentsExpandSessionOpen()).to.equal(true);
        document.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-stop-all')?.click();
        expect(stoppedIds).to.deep.equal(['p1', 'c1']);
        // Stop All must not collapse before the host refresh decides.
        expect(isWorkingAgentsExpandSessionOpen()).to.equal(true);
        expect(document.querySelector(`.${WORKING_EXPAND_CLIP_CLASS}.theia-mod-open`)).to.not.equal(null);
    });

    it('Expand view toggles maximize state and persists across park/restore', () => {
        const host = document.createElement('div');
        host.className = 'theia-mobile-projects-sticky-composer-inner';
        const rowHost = document.createElement('div');
        rowHost.className = 'theia-mobile-sticky-composer-changes-pill-host';
        const row = document.createElement('div');
        row.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const anchor = document.createElement('button');
        anchor.className = 'theia-mobile-sticky-composer-working-pill';
        row.append(anchor);
        rowHost.append(row);
        host.append(rowHost);
        document.body.append(host);

        const parent = member({ id: 'parent', title: 'Expand detail task' });
        openWorkingAgentsPopover({
            anchor,
            members: [parent],
            onSelect: () => undefined,
            onStopAll: () => undefined,
        });
        document.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-row')?.click();
        const expandBtn = document.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-expand');
        expect(expandBtn).to.not.equal(null);
        expect(expandBtn?.getAttribute('aria-pressed')).to.equal('false');
        expect(expandBtn?.title).to.equal('Expand view');

        expandBtn?.click();
        const shell = document.querySelector(`.${WORKING_CONTROL_CLASS}`);
        expect(shell?.classList.contains('theia-mod-detail-large')).to.equal(true);
        const expandAfter = document.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-expand');
        expect(expandAfter?.getAttribute('aria-pressed')).to.equal('true');
        expect(expandAfter?.title).to.equal('Restore');

        parkWorkingControlFromAncestor(host);
        host.replaceChildren();
        expect(isWorkingAgentsExpandSessionOpen()).to.equal(true);

        const newRowHost = document.createElement('div');
        newRowHost.className = 'theia-mobile-sticky-composer-changes-pill-host';
        const newRow = document.createElement('div');
        newRow.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const newAnchor = document.createElement('button');
        newAnchor.className = 'theia-mobile-sticky-composer-working-pill';
        newRow.append(newAnchor);
        newRowHost.append(newRow);
        host.append(newRowHost);

        const restored = restoreWorkingAgentsExpandIfNeeded({
            anchor: newAnchor,
            members: [parent],
            onSelect: () => undefined,
            onStopAll: () => undefined,
        });
        expect(restored).to.equal(true);
        expect(isWorkingAgentsExpandSessionOpen()).to.equal(true);
        expect(getWorkingAgentsDetailMemberId()).to.equal('parent');
        const shellAfter = document.querySelector(`.${WORKING_CONTROL_CLASS}`);
        expect(shellAfter?.classList.contains('theia-mod-detail-large')).to.equal(true);
        expect(shellAfter?.classList.contains('theia-mod-detail')).to.equal(true);
        const expandRestored = document.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-expand');
        expect(expandRestored?.getAttribute('aria-pressed')).to.equal('true');
        expect(document.querySelector(`.${WORKING_EXPAND_CLIP_CLASS}.theia-mod-open`)).to.not.equal(null);
    });

    it('transferWorkingControlToHost preserves the control node identity', () => {
        const fromHost = document.createElement('div');
        fromHost.className = 'theia-mobile-sticky-composer-changes-pill-host';
        const fromRow = document.createElement('div');
        fromRow.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const anchor = document.createElement('button');
        anchor.className = 'theia-mobile-sticky-composer-working-pill';
        fromRow.append(anchor);
        fromHost.append(fromRow);
        document.body.append(fromHost);

        const parent = member({ id: 'p1', title: 'Main task' });
        openWorkingAgentsPopover({
            anchor,
            members: [parent],
            onSelect: () => undefined,
            onStopAll: () => undefined,
        });
        const shellBefore = anchor.parentElement;
        expect(shellBefore?.classList.contains(WORKING_CONTROL_CLASS)).to.equal(true);

        const toHost = document.createElement('div');
        toHost.className = 'theia-mobile-sticky-composer-changes-pill-host';
        const toRow = document.createElement('div');
        toRow.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const changes = document.createElement('button');
        changes.className = 'theia-mobile-sticky-composer-changes-pill';
        toRow.append(changes);
        toHost.append(toRow);
        fromHost.parentElement?.insertBefore(toHost, fromHost.nextSibling);

        transferWorkingControlToHost(fromHost, toHost);
        expect(toRow.firstElementChild).to.equal(shellBefore);
        expect(shellBefore?.classList.contains('theia-mod-expanded')).to.equal(true);
        expect(isWorkingAgentsPopoverOpen(anchor)).to.equal(true);
        expect(document.querySelector(`.${WORKING_EXPAND_CLIP_CLASS}.theia-mod-open`)).to.not.equal(null);
    });
});
