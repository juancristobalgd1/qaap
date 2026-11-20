// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapTenantBackendUpdate } from '@theia/qaap-shared-core/lib/browser/qaap-tenant-update-client';
import {
    buildQaapUpdateHoverCardModel,
    computeQaapUpdateHoverCardPosition,
    qaapUpdateBuildsLine,
    shortQaapBuildSha,
} from './qaap-update-hover-card-model';

function update(overrides: Partial<QaapTenantBackendUpdate> = {}): QaapTenantBackendUpdate {
    return { backendBuild: 'abc1234', controlPlaneBuild: 'def5678', updatePending: true, runningTasks: 0, ...overrides };
}

describe('qaap-update-hover-card-model', () => {

    describe('shortQaapBuildSha', () => {
        it('cuts a long git SHA to 7 characters and keeps short or non-SHA ids', () => {
            expect(shortQaapBuildSha('b72a749af00e1234')).to.equal('b72a749');
            expect(shortQaapBuildSha(' abc1234 ')).to.equal('abc1234');
            expect(shortQaapBuildSha('release-42')).to.equal('release-42');
        });

        it('is undefined for a missing or blank build', () => {
            expect(shortQaapBuildSha(undefined)).to.equal(undefined);
            expect(shortQaapBuildSha('  ')).to.equal(undefined);
        });
    });

    describe('qaapUpdateBuildsLine', () => {
        it('shows both builds with an arrow', () => {
            expect(qaapUpdateBuildsLine(update({ backendBuild: 'b72a749af00e', controlPlaneBuild: 'def5678' })))
                .to.equal('Running build b72a749 → new build def5678');
        });

        it('omits the unknown build', () => {
            expect(qaapUpdateBuildsLine(update({ controlPlaneBuild: undefined }))).to.equal('Running build abc1234');
            expect(qaapUpdateBuildsLine(update({ backendBuild: '' }))).to.equal('New build def5678');
            expect(qaapUpdateBuildsLine(update({ backendBuild: undefined, controlPlaneBuild: undefined }))).to.equal(undefined);
        });
    });

    describe('buildQaapUpdateHoverCardModel', () => {
        it('invites a click when nothing blocks the update, and explains the reload', () => {
            const model = buildQaapUpdateHoverCardModel(update());
            expect(model.title).to.equal('Update ready. Click to update Qaap.');
            expect(model.details[0]).to.equal('Running build abc1234 → new build def5678');
            expect(model.details[1]).to.contain('reloads this page');
        });

        it('says the update waits for the running tasks, with their count', () => {
            expect(buildQaapUpdateHoverCardModel(update({ reason: 'agent-turns-running', runningTasks: 3 })).title)
                .to.equal('Update ready — it applies when your 3 running tasks finish.');
            expect(buildQaapUpdateHoverCardModel(update({ reason: 'agent-turns-running', runningTasks: 1 })).title)
                .to.equal('Update ready — it applies when your running task finishes.');
            expect(buildQaapUpdateHoverCardModel(update({ reason: 'agent-turns-running', runningTasks: 0 })).title)
                .to.equal('Update ready — it applies when your running tasks finish.');
        });

        it('mentions the confirmation before running tasks stop when they block the update', () => {
            const model = buildQaapUpdateHoverCardModel(update({ reason: 'agent-turns-running', runningTasks: 2 }));
            expect(model.details).to.have.length(2);
            expect(model.details[1]).to.contain('asked before running tasks stop');
        });

        it('shows "Updating…" while the update is in flight', () => {
            const model = buildQaapUpdateHoverCardModel(update(), true);
            expect(model.title).to.equal('Updating…');
            expect(model.details[model.details.length - 1]).to.contain('reloads');
        });

        it('has no builds line when both builds are unknown', () => {
            const model = buildQaapUpdateHoverCardModel(update({ backendBuild: undefined, controlPlaneBuild: undefined }));
            expect(model.details).to.have.length(1);
        });
    });

    describe('computeQaapUpdateHoverCardPosition', () => {
        const viewport = { width: 1200, height: 800 };
        const card = { width: 260, height: 90 };

        it('places the card above the button, aligned with its left edge', () => {
            const position = computeQaapUpdateHoverCardPosition({ left: 100, top: 740, right: 144, bottom: 784 }, card, viewport);
            expect(position).to.deep.equal({ left: 100, top: 642, side: 'above' });
        });

        it('falls below the button when there is no room above', () => {
            const position = computeQaapUpdateHoverCardPosition({ left: 100, top: 20, right: 144, bottom: 64 }, card, viewport);
            expect(position).to.deep.equal({ left: 100, top: 72, side: 'below' });
        });

        it('clamps the card inside the viewport horizontally', () => {
            const position = computeQaapUpdateHoverCardPosition({ left: 1100, top: 740, right: 1144, bottom: 784 }, card, viewport);
            expect(position.left).to.equal(1200 - 8 - 260);
            const leftEdge = computeQaapUpdateHoverCardPosition({ left: -20, top: 740, right: 24, bottom: 784 }, card, viewport);
            expect(leftEdge.left).to.equal(8);
        });
    });
});
