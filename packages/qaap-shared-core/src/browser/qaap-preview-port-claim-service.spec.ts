// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { requestQaapPreviewPortClaim } from './qaap-preview-port-claim-service';

describe('qaap-preview-port-claim-service', () => {
    const origin = 'http://localhost:3000/';
    const root = 'file:///workspace/current';

    it('posts the port and current workspace root and accepts only 204', async () => {
        let requestedUrl: string | undefined;
        let requestedInit: RequestInit | undefined;
        const result = await requestQaapPreviewPortClaim(5173, root, origin, async (input, init) => {
            requestedUrl = String(input);
            requestedInit = init;
            return { status: 204 };
        });

        expect(result).to.deep.equal({ kind: 'claimed' });
        expect(requestedUrl).to.equal('http://localhost:3000/qaap-dev/api/claim');
        expect(requestedInit?.method).to.equal('POST');
        expect(requestedInit?.headers).to.deep.equal({ 'Content-Type': 'application/json' });
        expect(JSON.parse(String(requestedInit?.body))).to.deep.equal({ port: 5173, root });
    });

    it('maps 409 to conflict and keeps all other statuses fail-closed', async () => {
        expect(await requestQaapPreviewPortClaim(5173, root, origin, async () => ({ status: 409 })))
            .to.deep.equal({ kind: 'conflict' });
        expect(await requestQaapPreviewPortClaim(5173, root, origin, async () => ({ status: 403 })))
            .to.deep.equal({ kind: 'error', status: 403 });
        expect(await requestQaapPreviewPortClaim(5173, root, origin, async () => Promise.reject(new Error('offline'))))
            .to.deep.equal({ kind: 'error' });
    });

    it('returns the backend-assigned collision-free port for a process identity', async () => {
        const identity = {
            workspaceId: root,
            projectId: 'project-a',
            processId: 'process-a',
            root,
        };
        let requestedBody: unknown;
        const result = await requestQaapPreviewPortClaim(5173, root, origin, async (_input, init) => {
            requestedBody = JSON.parse(String(init?.body));
            return {
                status: 200,
                json: async () => ({
                    previewId: 'u-alice-w-project-p-project-x-process-abc1234',
                    previewUrl: 'http://localhost:3000/qaap-preview/u-alice-w-project-p-project-x-process-abc1234/',
                    port: 5174,
                }),
            };
        }, identity);

        expect(requestedBody).to.deep.equal({ port: 5173, ...identity });
        expect(result.kind).to.equal('claimed');
        expect(result.kind === 'claimed' && result.port).to.equal(5174);
    });
});
