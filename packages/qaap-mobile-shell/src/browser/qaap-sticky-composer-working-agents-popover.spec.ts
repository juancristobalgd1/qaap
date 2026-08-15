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
    refreshWorkingAgentsDetailActivityFeed,
    renderWorkingAgentsDetailPanel,
    renderWorkingAgentsPopoverPanel,
    resolveWorkingAgentStatusLabel,
    restoreWorkingAgentsExpandIfNeeded,
    syncWorkingAgentsExpandContent,
    transferWorkingControlToHost,
} from './qaap-sticky-composer-working-agents-popover';
import { buildWorkingAgentDetailActivityFeed } from './qaap-sticky-composer-working-detail-activity';

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

    it('renders a progress track with filled segments when progressCurrent/Total are set', () => {
        const agent = member({
            id: 'progress-agent',
            title: 'Multi-step task',
            progressCurrent: 3,
            progressTotal: 7,
        });
        const panel = renderWorkingAgentsPopoverPanel({
            entries: flattenWorkingAgentsTree([agent]),
            onStopAll: () => undefined,
            onClose: () => undefined,
            onSelect: () => undefined,
        });
        const row = panel.querySelector<HTMLElement>('.qaap-working-agents-popover-row');
        expect(row).to.not.equal(null);
        expect(row!.classList.contains('qaap-mod-has-progress')).to.equal(true);
        const track = row!.querySelector<HTMLElement>('.qaap-working-agents-progress-track');
        expect(track).to.not.equal(null);
        expect(track!.getAttribute('role')).to.equal('progressbar');
        expect(track!.getAttribute('aria-valuenow')).to.equal('3');
        expect(track!.getAttribute('aria-valuemax')).to.equal('7');
        const segments = track!.querySelectorAll('.qaap-working-agents-progress-segment');
        expect(segments.length).to.equal(7);
        const filled = track!.querySelectorAll('.qaap-working-agents-progress-segment.theia-mod-filled');
        expect(filled.length).to.equal(3);
    });

    it('does NOT render a progress track when progressTotal is zero or missing', () => {
        const agent = member({
            id: 'no-progress-agent',
            title: 'No progress task',
        });
        const panel = renderWorkingAgentsPopoverPanel({
            entries: flattenWorkingAgentsTree([agent]),
            onStopAll: () => undefined,
            onClose: () => undefined,
            onSelect: () => undefined,
        });
        const row = panel.querySelector<HTMLElement>('.qaap-working-agents-popover-row');
        expect(row).to.not.equal(null);
        expect(row!.classList.contains('qaap-mod-has-progress')).to.equal(false);
        expect(row!.querySelector('.qaap-working-agents-progress-track')).to.equal(null);
    });

    it('caps visual segments at 20 while keeping the fill ratio accurate', () => {
        const agent = member({
            id: 'long-task',
            title: '50-step task',
            progressCurrent: 25,
            progressTotal: 50,
        });
        const panel = renderWorkingAgentsPopoverPanel({
            entries: flattenWorkingAgentsTree([agent]),
            onStopAll: () => undefined,
            onClose: () => undefined,
            onSelect: () => undefined,
        });
        const track = panel.querySelector<HTMLElement>('.qaap-working-agents-progress-track');
        expect(track).to.not.equal(null);
        const segments = track!.querySelectorAll('.qaap-working-agents-progress-segment');
        expect(segments.length).to.equal(20); // capped
        const filled = track!.querySelectorAll('.qaap-working-agents-progress-segment.theia-mod-filled');
        // 25/50 = 50% → 10 of 20 segments filled
        expect(filled.length).to.equal(10);
    });

    it('renders header Stop All / close and indented child rows', async () => {
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
        let stoppedMemberId: string | undefined;
        const panel = renderWorkingAgentsPopoverPanel({
            entries: flattenWorkingAgentsTree([parent, child]),
            onStopAll: () => { stopped = true; },
            onClose: () => { closed = true; },
            onSelect: m => { selected = m.id; },
            onStop: m => { stoppedMemberId = m.id; },
        });
        expect(panel.querySelector('.qaap-working-agents-popover-title')?.textContent).to.equal('2 Working');
        expect(panel.querySelector('.qaap-working-agents-popover-close .codicon-close')).to.not.equal(null);
        const stopAll = panel.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-stop-all');
        stopAll?.click();
        expect(stopped).to.equal(false);
        expect(stopAll?.textContent).to.equal('Confirm Stop All');
        stopAll?.click();
        expect(stopped).to.equal(true);
        panel.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-close')?.click();
        expect(closed).to.equal(true);

        const rows = panel.querySelectorAll('.qaap-working-agents-popover-row');
        expect(rows).to.have.length(2);
        expect(rows[1].classList.contains('theia-mod-child')).to.equal(true);
        expect(rows[0].querySelector('.qaap-working-agents-popover-row-title')?.textContent)
            .to.equal('Parent task');
        expect(rows[0].querySelectorAll('.qaap-working-loader-dot')).to.have.length(6);
        expect(rows[0].querySelector('.qaap-working-agents-popover-cloud')).to.not.equal(null);
        expect(rows[0].querySelector('.qaap-working-agents-popover-row-stop')?.textContent).to.equal('Stop');
        expect(rows[0].querySelector('.qaap-working-agents-popover-row-main')?.getAttribute('aria-label'))
            .to.contain('run parent');
        const childStatus = rows[1].querySelector('.qaap-working-agents-popover-row-status');
        expect(childStatus?.textContent).to.equal('Reading files');
        expect(childStatus?.classList.contains('theia-mod-shimmer')).to.equal(true);
        expect(rows[0].querySelector('.qaap-working-agents-popover-row-status')?.classList.contains('theia-mod-shimmer'))
            .to.equal(true);
        rows[0].querySelector<HTMLButtonElement>('.qaap-working-agents-popover-row-stop')?.click();
        await Promise.resolve();
        expect(stoppedMemberId).to.equal('parent');
        expect(selected).to.equal(undefined);
        (rows[1].querySelector('.qaap-working-agents-popover-row-main') as HTMLButtonElement).click();
        expect(selected).to.equal('child');
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
            resolveDetailActivityFeed: m => ({
                items: [],
                thoughtTitle: 'Thought briefly',
                thoughtText: 'Summarize the pull request changes.',
                exploredSummary: 'Explored 2 files, 1 search',
                liveLabel: m.activityLabel,
            }),
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
        expect(detail?.querySelector('.qaap-working-agents-popover-title')?.textContent)
            .to.equal('Review the latest pull request: summarize changes');
        expect(detail?.querySelector('.qaap-working-agents-popover-back')).to.not.equal(null);
        expect(detail?.querySelector('.qaap-working-agents-popover-header .qaap-working-agents-popover-cloud'))
            .to.not.equal(null);
        expect(detail?.querySelector('.qaap-working-agents-popover-expand .codicon-screen-full'))
            .to.not.equal(null);
        expect(detail?.querySelector('.qaap-working-agents-popover-close .codicon-close')).to.not.equal(null);
        expect(detail?.querySelector('.qaap-working-agents-popover-header .qaap-working-agents-popover-stop-one'))
            .to.equal(null);
        expect(detail?.textContent).to.contain('Review the latest pull request');
        expect(detail?.textContent).to.contain('Thought briefly');
        expect(detail?.textContent).to.contain('Summarize the pull request changes.');
        expect(detail?.textContent).to.contain('Explored 2 files, 1 search');
        expect(detail?.textContent).to.contain('Summarizing diff');
        expect(detail?.textContent).to.contain('1 Subagents');
        expect(detail?.textContent).to.contain('Explore PR files');
        expect(detail?.textContent).to.not.contain('Project');
        expect(detail?.textContent).to.not.contain('Workspace');
        expect(openedSession).to.equal(undefined);
        detail?.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-back')?.click();
        expect(getWorkingAgentsDetailMemberId()).to.equal(undefined);
        expect(document.querySelector(`.${WORKING_DETAIL_PANEL_CLASS}`)).to.equal(null);
        expect(shell?.classList.contains('theia-mod-expanded')).to.equal(true);
        expect(document.querySelector('.qaap-working-agents-popover-title')?.textContent).to.equal('2 Working');
    });

    it('stops one selected agent from the list and leaves unrelated runs available', async () => {
        const rowHost = document.createElement('div');
        rowHost.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const anchor = document.createElement('button');
        anchor.className = 'theia-mobile-sticky-composer-working-pill';
        rowHost.append(anchor);
        document.body.append(rowHost);
        const first = member({ id: 'first', title: 'Same task', agentId: 'qaiq' });
        const second = member({ id: 'second', title: 'Same task', agentId: 'codex' });
        let stoppedId: string | undefined;
        openWorkingAgentsPopover({
            anchor,
            members: [first, second],
            onSelect: () => undefined,
            onStop: async target => {
                stoppedId = target.id;
                return true;
            },
            onStopAll: () => undefined,
        });

        const stop = document.querySelector<HTMLButtonElement>(
            '.qaap-working-agents-popover-row[data-member-id="first"] .qaap-working-agents-popover-row-stop',
        );
        expect(stop?.getAttribute('aria-label')).to.equal('Stop QAIQ');
        stop?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(stoppedId).to.equal('first');
        expect(isWorkingAgentsExpandSessionOpen()).to.equal(true);
        expect(getWorkingAgentsDetailMemberId()).to.equal(undefined);
        expect(document.querySelector(`.${WORKING_DETAIL_PANEL_CLASS}`)).to.equal(null);
        const remaining = document.querySelectorAll('.qaap-working-agents-popover-row');
        expect(remaining).to.have.length(1);
        expect(remaining[0].getAttribute('data-member-id')).to.equal('second');
        expect(remaining[0].querySelector('.qaap-working-agents-popover-row-title')?.textContent)
            .to.equal('Same task');
        expect(remaining[0].textContent).to.not.contain('Codex ·');
    });

    it('keeps Stop All busy until asynchronous cancellation settles', async () => {
        let release: (() => void) | undefined;
        const pending = new Promise<void>(resolve => { release = resolve; });
        const panel = renderWorkingAgentsPopoverPanel({
            entries: [{ member: member({ id: 'one', title: 'One task' }), depth: 0 }],
            onStopAll: () => pending,
            onClose: () => undefined,
            onSelect: () => undefined,
        });
        document.body.append(panel);
        const stop = panel.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-stop-all')!;
        stop.click();
        expect(stop.disabled).to.equal(true);
        expect(stop.getAttribute('aria-busy')).to.equal('true');
        release?.();
        await pending;
        await Promise.resolve();
        expect(stop.disabled).to.equal(false);
        expect(stop.hasAttribute('aria-busy')).to.equal(false);
    });

    it('renders DETAIL activity feed instead of project/workspace metadata', () => {
        const feed = buildWorkingAgentDetailActivityFeed([
            { type: 'thinking', content: 'Inspect detail chrome.' },
            {
                type: 'tool',
                name: 'Read',
                args: JSON.stringify({ path: 'popover.ts' }),
                toolUseId: 'r1',
                finished: true,
                result: 'ok',
            },
        ], { streaming: true });
        const panel = renderWorkingAgentsDetailPanel({
            member: member({
                id: 'parent',
                title: 'Detail activity feed',
                activityLabel: 'Reading files',
                projectName: 'ShouldNotShowAsPrimary',
                cwd: '/tmp/should-not-show',
            }),
            children: [],
            activityFeed: feed,
            onBack: () => undefined,
            onClose: () => undefined,
            onToggleLarge: () => undefined,
            onSelectChild: () => undefined,
        });
        expect(panel.querySelector('.qaap-working-agents-detail-activity')).to.not.equal(null);
        expect(panel.textContent).to.contain('Thought briefly');
        expect(panel.textContent).to.contain('Explored');
        expect(panel.textContent).to.not.contain('ShouldNotShowAsPrimary');
        expect(panel.textContent).to.not.contain('/tmp/should-not-show');
        expect(panel.textContent).to.not.match(/\bProject\b/);
        expect(panel.textContent).to.not.match(/\bWorkspace\b/);
    });

    it('renders a command-output card for VPS tasks without conversationId', () => {
        const panel = renderWorkingAgentsDetailPanel({
            member: member({
                id: 'task:vps-1',
                kind: 'leader-task',
                title: 'npm run test',
                command: 'npm run test',
                taskId: 'vps-1',
                state: 'running',
                conversationId: undefined,
            }),
            children: [],
            commandLogText: 'PASS src/foo.spec.ts\n',
            onBack: () => undefined,
            onClose: () => undefined,
            onToggleLarge: () => undefined,
            onSelectChild: () => undefined,
        });
        const log = panel.querySelector('.qaap-working-agents-detail-command-log');
        expect(log).to.not.equal(null);
        expect(log?.getAttribute('data-task-id')).to.equal('vps-1');
        expect(log?.getAttribute('data-state')).to.equal('running');
        expect(panel.textContent).to.contain('PASS src/foo.spec.ts');
        expect(panel.textContent).to.match(/Command output/i);
        expect(panel.querySelector('.qaap-working-agents-detail-command-log-live')).to.not.equal(null);
        expect(panel.querySelector('.qaap-working-agents-detail-command-log-output')?.textContent)
            .to.contain('PASS src/foo.spec.ts');
    });

    it('renders a waiting command-output state before the first chunk', () => {
        const panel = renderWorkingAgentsDetailPanel({
            member: member({
                id: 'task:vps-wait',
                kind: 'leader-task',
                title: 'npm run build',
                command: 'npm run build',
                taskId: 'vps-wait',
                state: 'running',
                conversationId: undefined,
            }),
            children: [],
            onBack: () => undefined,
            onClose: () => undefined,
            onToggleLarge: () => undefined,
            onSelectChild: () => undefined,
        });
        const output = panel.querySelector('.qaap-working-agents-detail-command-log-output');
        expect(output?.textContent).to.match(/Waiting for output/i);
        expect(output?.classList.contains('theia-mod-waiting')).to.equal(true);
    });
    it('omits command-output card for conversation agents', () => {
        const panel = renderWorkingAgentsDetailPanel({
            member: member({
                id: 'c1',
                conversationId: 'c1',
                title: 'Agent chat',
                state: 'streaming',
            }),
            children: [],
            onBack: () => undefined,
            onClose: () => undefined,
            onToggleLarge: () => undefined,
            onSelectChild: () => undefined,
        });
        expect(panel.querySelector('.qaap-working-agents-detail-command-log')).to.equal(null);
    });

    it('omits command-output card when the VPS log already has OpenCode transcript segments', () => {
        const opencodeLog = [
            '{"type":"tool_use","part":{"id":"p1","type":"tool","tool":"read","state":{"status":"completed","input":{"filePath":"a.ts"},"output":"ok"}}}',
            '{"type":"text","part":{"type":"text","text":"Done reading."}}',
        ].join('\n');
        const panel = renderWorkingAgentsDetailPanel({
            member: member({
                id: 'task:vps-oc',
                kind: 'leader-task',
                title: 'opencode run',
                command: 'opencode run --format json hi',
                taskId: 'vps-oc',
                state: 'running',
                conversationId: undefined,
            }),
            children: [],
            commandLogText: opencodeLog,
            activityFeed: {
                items: [{
                    label: 'Read a.ts',
                    verb: 'Read',
                    detail: 'a.ts',
                    state: 'success',
                    navigate: 'file',
                    toolKind: 'reading',
                }],
                liveLabel: 'Working',
            },
            onBack: () => undefined,
            onClose: () => undefined,
            onToggleLarge: () => undefined,
            onSelectChild: () => undefined,
        });
        expect(panel.querySelector('.qaap-working-agents-detail-command-log')).to.equal(null);
        expect(panel.textContent).to.not.match(/Command output/i);
        expect(panel.textContent).to.not.include('step_finish');
        expect(panel.textContent).to.contain('Read');
    });

    it('notifies detail member changes and refreshes activity feed after hydration', () => {
        const rowHost = document.createElement('div');
        rowHost.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const anchor = document.createElement('button');
        anchor.className = 'theia-mobile-sticky-composer-working-pill';
        rowHost.append(anchor);
        document.body.append(rowHost);

        const agent = member({
            id: 'agent-live',
            title: 'Hydrate working detail activity',
            activityLabel: 'Working',
        });
        let feedVersion = 0;
        const detailMembers: Array<string | undefined> = [];
        openWorkingAgentsPopover({
            anchor,
            members: [agent],
            onSelect: () => undefined,
            onStopAll: () => undefined,
            onDetailMemberChange: m => detailMembers.push(m?.id),
            resolveDetailActivityFeed: () => {
                if (feedVersion === 0) {
                    return {
                        items: [],
                        liveLabel: 'Working',
                    };
                }
                return {
                    items: [],
                    thoughtTitle: 'Thought briefly',
                    thoughtText: 'Inspect the hydrated transcript segments.',
                    exploredSummary: 'Explored 2 files, 1 search',
                    liveLabel: 'Reading files',
                };
            },
        });

        document.querySelector<HTMLButtonElement>(
            '.qaap-working-agents-popover-row[data-member-id="agent-live"]',
        )!.click();
        expect(getWorkingAgentsDetailMemberId()).to.equal('agent-live');
        expect(detailMembers).to.deep.equal(['agent-live']);
        expect(document.querySelector('.qaap-working-agents-detail-body')?.textContent)
            .to.equal('Working');

        feedVersion = 1;
        expect(refreshWorkingAgentsDetailActivityFeed()).to.equal(true);
        const bodyText = document.querySelector('.qaap-working-agents-detail-body')?.textContent ?? '';
        expect(bodyText).to.contain('Thought briefly');
        expect(bodyText).to.contain('Inspect the hydrated transcript segments.');
        expect(bodyText).to.contain('Explored 2 files, 1 search');
        expect(bodyText).to.contain('Reading files');

        document.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-back')?.click();
        expect(detailMembers).to.deep.equal(['agent-live', undefined]);
        expect(getWorkingAgentsDetailMemberId()).to.equal(undefined);
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
