// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapPushNotifyRequest } from '../common/qaap-cloud-api-types';
import { QaapCloudWorkspaceEndpoint } from './qaap-cloud-workspace-endpoint';

describe('Qaap push notification routing', () => {

    it('forwards the Work Hub conversation deep-link fields to Web Push', async () => {
        let forwarded: QaapPushNotifyRequest | undefined;
        const endpoint = Object.create(QaapCloudWorkspaceEndpoint.prototype) as QaapCloudWorkspaceEndpoint;
        Object.assign(endpoint, {
            requireAuth: () => ({ kind: 'authenticated', userLogin: 'alice' }),
            webPush: {
                notify: async (request: QaapPushNotifyRequest): Promise<{ sent: number; failed: number }> => {
                    forwarded = request;
                    return { sent: 1, failed: 0 };
                },
            },
        });

        let responseBody: unknown;
        const response = {
            json: (body: unknown): void => { responseBody = body; },
        };
        await (endpoint as unknown as {
            handlePushNotify(req: unknown, res: unknown): Promise<void>;
        }).handlePushNotify({
            body: {
                title: 'Task finished',
                body: 'Hi completed.',
                tag: 'qaap-agent-task-42',
                route: 'conversation',
                conversationId: 'conversation-42',
                cwd: '/workspace/project',
                userLogin: 'another-user',
            },
        }, response);

        expect(forwarded).to.deep.equal({
            title: 'Task finished',
            body: 'Hi completed.',
            tag: 'qaap-agent-task-42',
            userLogin: 'alice',
            route: 'conversation',
            conversationId: 'conversation-42',
            cwd: '/workspace/project',
        });
        expect(responseBody).to.deep.equal({ sent: 1, failed: 0 });
    });
});
