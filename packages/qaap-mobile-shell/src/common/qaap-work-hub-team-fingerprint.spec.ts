// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    buildWorkHubTeamRowFingerprint,
    buildWorkHubTeamSectionFingerprint,
    QAAP_TEAM_MEMBER_ID_ATTR,
    QAAP_TEAM_ROW_FP_ATTR,
    QAAP_TEAM_SECTION_FP_ATTR,
} from './qaap-work-hub-team-fingerprint';
import type { WorkHubTeamMember } from './qaap-work-hub-team';
import { MobileProjectsTeamHubUi } from '../browser/mobile-projects-team-hub-ui';

describe('qaap-work-hub-team-fingerprint', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    const leader: WorkHubTeamMember = {
        id: 'leader-1',
        kind: 'conversation',
        agentId: 'qaiq',
        title: 'Refactor inbox',
        state: 'streaming',
        cwd: '/repo',
        projectId: 'p1',
        projectName: 'qaap-mobile-shell',
        createdAt: 1,
        updatedAt: 100,
        childCount: 1,
    };

    const child: WorkHubTeamMember = {
        id: 'child-1',
        kind: 'subtask',
        parentId: 'leader-1',
        agentId: 'codex',
        title: 'Patch rows',
        state: 'running',
        cwd: '/repo',
        projectId: 'p1',
        projectName: 'qaap-mobile-shell',
        createdAt: 1,
        updatedAt: 90,
        childCount: 0,
    };

    it('buildWorkHubTeamSectionFingerprint tracks member ids and approval count', () => {
        const fp = buildWorkHubTeamSectionFingerprint([leader, child], 2);
        expect(fp).to.include('a:2');
        expect(fp).to.include('m:child-1:leader-1');
        expect(fp).to.include('m:leader-1:');
    });

    it('buildWorkHubTeamRowFingerprint changes when progress updates', () => {
        const before = buildWorkHubTeamRowFingerprint(leader);
        const after = buildWorkHubTeamRowFingerprint({
            ...leader,
            progressCurrent: 2,
            progressTotal: 5,
        });
        expect(before).to.not.equal(after);
    });

    it('patchSections updates only rows whose fingerprint changed', () => {
        const host = document.createElement('div');
        const ui = new MobileProjectsTeamHubUi({
            resolveAgentLabel: agentId => `@${agentId}`,
            onMemberClick: () => undefined,
        });
        ui.renderSections(host, [leader, child], { embedded: true });
        const list = host.querySelector('.theia-mobile-hub-team')!;
        const leaderRow = list.querySelector<HTMLElement>(
            `.theia-mobile-hub-team-row[${QAAP_TEAM_MEMBER_ID_ATTR}="leader-1"]`,
        )!;
        leaderRow.setAttribute(QAAP_TEAM_ROW_FP_ATTR, 'stale');

        const patched = ui.patchSections(host, [{
            ...leader,
            activityLabel: 'Editing files',
        }, child], { embedded: true });
        expect(patched).to.equal(true);
        expect(
            list.querySelector(`[${QAAP_TEAM_MEMBER_ID_ATTR}="leader-1"]`)?.getAttribute(QAAP_TEAM_ROW_FP_ATTR),
        ).to.not.equal('stale');
        expect(list.getAttribute(QAAP_TEAM_SECTION_FP_ATTR)).to.equal(
            buildWorkHubTeamSectionFingerprint([{ ...leader, activityLabel: 'Editing files' }, child], 0),
        );
    });
});
