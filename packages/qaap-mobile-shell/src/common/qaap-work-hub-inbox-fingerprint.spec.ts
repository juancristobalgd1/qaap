// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildWorkHubInboxRowFingerprint,
    buildWorkHubInboxRowFingerprintFromSummary,
    buildWorkHubInboxStructureFingerprint,
} from './qaap-work-hub-inbox-fingerprint';

describe('qaap-work-hub-inbox-fingerprint', () => {

    const summary = {
        id: 'conv-1',
        title: 'Task',
        status: 'streaming' as const,
        createdAt: 1,
        updatedAt: 2,
        messageCount: 1,
        agentId: 'qaiq',
        cwd: '/repo',
    };

    it('changes row fingerprint when streaming progress advances', () => {
        const base = buildWorkHubInboxRowFingerprint({
            rowKey: 'conv-1',
            status: 'streaming',
            title: 'Task',
            updatedAt: 1000,
            messageCount: 2,
            turnProgressCurrent: 1,
            turnProgressTotal: 4,
            visualStatusId: 'running',
        });
        const advanced = buildWorkHubInboxRowFingerprint({
            rowKey: 'conv-1',
            status: 'streaming',
            title: 'Task',
            updatedAt: 1000,
            messageCount: 2,
            turnProgressCurrent: 2,
            turnProgressTotal: 4,
            visualStatusId: 'running',
        });
        expect(base).to.not.equal(advanced);
    });

    it('changes row fingerprint when current transcript selection changes', () => {
        const inactive = buildWorkHubInboxRowFingerprintFromSummary(summary, {
            rowKey: 'conv-1',
            visualStatusId: 'running',
            isCurrent: false,
        });
        const active = buildWorkHubInboxRowFingerprintFromSummary(summary, {
            rowKey: 'conv-1',
            visualStatusId: 'running',
            isCurrent: true,
        });
        expect(inactive).to.not.equal(active);
    });

    it('changes row fingerprint when diff line counts change so the foot repaints', () => {
        const before = buildWorkHubInboxRowFingerprintFromSummary(
            { ...summary, linesAdded: 3, linesRemoved: 1 },
            { rowKey: 'conv-1', visualStatusId: 'running' },
        );
        const after = buildWorkHubInboxRowFingerprintFromSummary(
            { ...summary, linesAdded: 11, linesRemoved: 9 },
            { rowKey: 'conv-1', visualStatusId: 'running' },
        );
        expect(before).to.not.equal(after);
    });

    it('changes row fingerprint when the activity label changes', () => {
        const searching = buildWorkHubInboxRowFingerprintFromSummary(
            { ...summary, activityLabel: 'Searching' },
            { rowKey: 'conv-1', visualStatusId: 'running' },
        );
        const thinking = buildWorkHubInboxRowFingerprintFromSummary(
            { ...summary, activityLabel: 'Thinking' },
            { rowKey: 'conv-1', visualStatusId: 'running' },
        );
        expect(searching).to.not.equal(thinking);
    });

    it('detects structure changes when row order changes', () => {
        const first = buildWorkHubInboxStructureFingerprint({
            hubKind: 'tasks-inbox',
            query: '',
            groups: [{
                projectId: 'p1',
                itemCount: 2,
                rows: [{ rowKey: 'a' }, { rowKey: 'b' }],
                variantRunIds: [],
            }],
        });
        const reordered = buildWorkHubInboxStructureFingerprint({
            hubKind: 'tasks-inbox',
            query: '',
            groups: [{
                projectId: 'p1',
                itemCount: 2,
                rows: [{ rowKey: 'b' }, { rowKey: 'a' }],
                variantRunIds: [],
            }],
        });
        expect(first).to.not.equal(reordered);
    });
});
