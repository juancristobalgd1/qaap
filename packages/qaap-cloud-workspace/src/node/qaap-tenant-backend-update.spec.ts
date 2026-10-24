// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { computeTenantBackendUpdateStatus } from './qaap-tenant-backend-update';

describe('computeTenantBackendUpdateStatus', () => {

    it('reports no pending update when the backend runs the control-plane build', () => {
        expect(computeTenantBackendUpdateStatus({ backendBuild: 'abc1234', controlPlaneBuild: 'abc1234', deferred: false })).to.deep.equal({
            backendBuild: 'abc1234',
            controlPlaneBuild: 'abc1234',
            updatePending: false,
        });
    });

    it('reports a pending update with the agent-turns reason when a recreation is deferred', () => {
        expect(computeTenantBackendUpdateStatus({ backendBuild: 'old5678', controlPlaneBuild: 'abc1234', deferred: true })).to.deep.equal({
            backendBuild: 'old5678',
            controlPlaneBuild: 'abc1234',
            updatePending: true,
            reason: 'agent-turns-running',
        });
    });

    it('reports a pending update without a reason when builds differ and nothing is deferred', () => {
        // The next wake recreates the backend on the new image: no turn blocks it, so no reason.
        expect(computeTenantBackendUpdateStatus({ backendBuild: 'old5678', controlPlaneBuild: 'abc1234', deferred: false })).to.deep.equal({
            backendBuild: 'old5678',
            controlPlaneBuild: 'abc1234',
            updatePending: true,
        });
    });

    it('keeps a deferred recreation pending even when the reported builds match', () => {
        const status = computeTenantBackendUpdateStatus({ backendBuild: 'abc1234', controlPlaneBuild: 'abc1234', deferred: true });
        expect(status.updatePending).to.equal(true);
        expect(status.reason).to.equal('agent-turns-running');
    });

    it('never guesses a pending update from unknown or dev builds', () => {
        expect(computeTenantBackendUpdateStatus({ backendBuild: undefined, controlPlaneBuild: 'abc1234', deferred: false }).updatePending).to.equal(false);
        expect(computeTenantBackendUpdateStatus({ backendBuild: 'old5678', controlPlaneBuild: undefined, deferred: false }).updatePending).to.equal(false);
        expect(computeTenantBackendUpdateStatus({ backendBuild: 'old5678', controlPlaneBuild: 'dev', deferred: false }).updatePending).to.equal(false);
        expect(computeTenantBackendUpdateStatus({ backendBuild: ' ', controlPlaneBuild: 'abc1234', deferred: false }).backendBuild).to.equal(undefined);
    });

    it('trims build strings before comparing them', () => {
        expect(computeTenantBackendUpdateStatus({ backendBuild: ' abc1234\n', controlPlaneBuild: 'abc1234', deferred: false }).updatePending).to.equal(false);
    });
});
