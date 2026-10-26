// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildLivePreviewPortHint, pickReservedDevPreviewPort, type QaapAgentPreviewClaimCandidate } from './qaap-agent-live-preview-port';

describe('qaap-agent-live-preview-port', () => {

    const root = '/workspace/repos/users/jcristgd/shadcn-landing-page';
    const taskCwd = root;

    describe('pickReservedDevPreviewPort', () => {

        it('returns the only claim, whatever its root or section', () => {
            const claims: QaapAgentPreviewClaimCandidate[] = [{ port: 5175, root: '/elsewhere', conversationId: 'other' }];
            expect(pickReservedDevPreviewPort(claims, taskCwd, 'mine')).to.equal(5175);
        });

        it('returns no port when there are no claims', () => {
            expect(pickReservedDevPreviewPort([], taskCwd, 'mine')).to.be.undefined;
        });

        it('prefers the claim of the task section over another section of the same root', () => {
            const claims: QaapAgentPreviewClaimCandidate[] = [
                { port: 5174, root, conversationId: 'older-section' },
                { port: 5175, root, conversationId: 'task-section' },
            ];
            expect(pickReservedDevPreviewPort(claims, taskCwd, 'task-section')).to.equal(5175);
        });

        it('treats a legacy claim without a section as the default section and still matches the exact root', () => {
            const claims: QaapAgentPreviewClaimCandidate[] = [
                { port: 5174, root: '/other/project' },
                { port: 5175, root, conversationId: 'task-section' },
            ];
            expect(pickReservedDevPreviewPort(claims, taskCwd, undefined)).to.equal(5175);
            expect(pickReservedDevPreviewPort(claims, taskCwd, 'task-section')).to.equal(5175);
        });

        it('falls back to the claim whose root is exactly the task cwd when the task has no section link', () => {
            const claims: QaapAgentPreviewClaimCandidate[] = [
                { port: 5174, root: `${root}/packages/api`, conversationId: 'a' },
                { port: 5175, root, conversationId: 'b' },
            ];
            expect(pickReservedDevPreviewPort(claims, taskCwd, undefined)).to.equal(5175);
        });

        it('falls back to the exact root when the task section has no claim', () => {
            const claims: QaapAgentPreviewClaimCandidate[] = [
                { port: 5174, root: '/unrelated', conversationId: 'a' },
                { port: 5175, root, conversationId: 'b' },
            ];
            expect(pickReservedDevPreviewPort(claims, taskCwd, 'no-claim-section')).to.equal(5175);
        });

        it('returns undefined when two claims are unlinked and neither root is the task cwd', () => {
            const claims: QaapAgentPreviewClaimCandidate[] = [
                { port: 5174, root: '/a', conversationId: 'x' },
                { port: 5175, root: '/b', conversationId: 'y' },
            ];
            expect(pickReservedDevPreviewPort(claims, taskCwd, undefined)).to.be.undefined;
        });

        it('returns undefined when two claims share the task root and the task cannot be linked to either', () => {
            const claims: QaapAgentPreviewClaimCandidate[] = [
                { port: 5174, root, conversationId: 'a' },
                { port: 5175, root, conversationId: 'b' },
            ];
            expect(pickReservedDevPreviewPort(claims, taskCwd, undefined)).to.be.undefined;
            expect(pickReservedDevPreviewPort(claims, taskCwd, 'c')).to.be.undefined;
        });

        it('does not match a child folder as the exact root', () => {
            const claims: QaapAgentPreviewClaimCandidate[] = [
                { port: 5174, root: `${root}/app`, conversationId: 'a' },
                { port: 5175, root: `${root}/web`, conversationId: 'b' },
            ];
            expect(pickReservedDevPreviewPort(claims, taskCwd, undefined)).to.be.undefined;
        });
    });

    describe('buildLivePreviewPortHint', () => {

        it('names the reserved port and warns against the port in .qaap/preview.json', () => {
            const hint = buildLivePreviewPortHint(5175);
            expect(hint).to.equal('Qaap\'s live preview for this project runs on port 5175 (see the Preview tab). '
                + 'The port in .qaap/preview.json is only the preferred port; never report it as the app\'s address.');
        });

        it('omits any port when none is reserved and points to the Preview tab', () => {
            const hint = buildLivePreviewPortHint(undefined);
            expect(hint).to.not.match(/runs on port/);
            expect(hint).to.match(/^The port in \.qaap\/preview\.json is only the preferred port; never report it as the app's address\./);
            expect(hint).to.contain('Refer the user to the Preview tab for the live address.');
        });
    });
});
