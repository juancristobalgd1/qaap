// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    buildMissionControlRowFingerprint,
    buildMissionControlStructureFingerprint,
    QAAP_MC_ROW_FP_ATTR,
    QAAP_MC_ROW_KEY_ATTR,
} from './qaap-work-mission-control-fingerprint';
import {
    MobileWorkMissionControl,
    type MissionControlItem,
} from '../browser/mobile-work-mission-control';

describe('qaap-work-mission-control-fingerprint', () => {

    it('buildMissionControlStructureFingerprint tracks row order and filters', () => {
        const fp = buildMissionControlStructureFingerprint({
            expanded: true,
            laneFilter: 'running',
            surfaceFilter: 'task',
            query: 'sidebar',
            showOverview: false,
            rowKeys: ['p1:c-a', 'p1:c-b'],
        });
        expect(fp).to.include('e:1');
        expect(fp).to.include('l:running');
        expect(fp).to.include('q:sidebar');
        expect(fp).to.include('r:p1:c-a');
        expect(fp).to.include('r:p1:c-b');
    });

    it('buildMissionControlRowFingerprint changes when progress updates', () => {
        const before = buildMissionControlRowFingerprint({
            key: 'p1:c1',
            lane: 'running',
            title: 'Task',
            updatedAt: 10,
            progressCurrent: 1,
            progressTotal: 4,
        });
        const after = buildMissionControlRowFingerprint({
            key: 'p1:c1',
            lane: 'running',
            title: 'Task',
            updatedAt: 11,
            progressCurrent: 2,
            progressTotal: 4,
        });
        expect(before).to.not.equal(after);
    });
});

describe('MobileWorkMissionControl.patchRows', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    const baseItem = (overrides: Partial<MissionControlItem>): MissionControlItem => ({
        key: 'p1:c1',
        conversationId: 'c1',
        projectId: 'p1',
        projectName: 'qaap-mobile-shell',
        projectColor: '#4a9',
        title: 'Streaming task',
        lane: 'running',
        surface: 'task',
        updatedAt: 100,
        hasPullRequest: false,
        progressCurrent: 2,
        progressTotal: 5,
        ...overrides,
    });

    it('updates running rows without rebuilding the panel structure', () => {
        const host = document.createElement('div');
        const ui = new MobileWorkMissionControl({
            formatRelativeTime: () => 'now',
            onOpenItem: () => undefined,
            onShowAll: () => undefined,
        });
        const items = [baseItem({})];
        ui.render(host, items, { expanded: true, showFilters: true });
        const panel = host.querySelector('.theia-mobile-mission-control') as HTMLElement;
        const row = panel.querySelector<HTMLElement>(
            `.theia-mobile-mission-control-row[${QAAP_MC_ROW_KEY_ATTR}="p1:c1"]`,
        )!;
        row.setAttribute(QAAP_MC_ROW_FP_ATTR, 'stale');

        const patched = ui.patchRows(panel, [baseItem({ progressCurrent: 4 })], {
            expanded: true,
            showFilters: true,
        });
        expect(patched).to.equal(true);
        expect(
            panel.querySelector(`[${QAAP_MC_ROW_KEY_ATTR}="p1:c1"]`)?.getAttribute(QAAP_MC_ROW_FP_ATTR),
        ).to.not.equal('stale');
    });
});
