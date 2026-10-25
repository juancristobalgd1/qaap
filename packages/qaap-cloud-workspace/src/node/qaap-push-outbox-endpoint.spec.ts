// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_TENANT_PUSH_OUTBOX_PATH } from '../common/qaap-cloud-api-types';
import { QAAP_TENANT_BUSY_PROBE_HEADER, QaapTenantBusyProbe } from './qaap-tenant-busy-probe';
import { QaapPushOutbox } from './qaap-push-outbox';
import { QaapPushOutboxEndpoint } from './qaap-push-outbox-endpoint';

const SECRET = 'a'.repeat(40);
const LOGIN = 'alice';

describe('QaapPushOutboxEndpoint (tenant backend)', () => {
    const envKeys = ['QAAP_TENANT_BACKEND_MODE', 'QAAP_TENANT_BACKEND_SECRET', 'QAAP_TENANT_LOGIN'] as const;
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const key of envKeys) {
            saved[key] = process.env[key];
        }
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_TENANT_BACKEND_SECRET = SECRET;
        process.env.QAAP_TENANT_LOGIN = LOGIN;
    });

    afterEach(() => {
        for (const key of envKeys) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
    });

    function setup(): { route: (req: unknown, res: unknown) => void, outbox: QaapPushOutbox } {
        const routes: Record<string, (req: unknown, res: unknown) => void> = {};
        const outbox = new QaapPushOutbox();
        const endpoint = Object.create(QaapPushOutboxEndpoint.prototype) as QaapPushOutboxEndpoint;
        Object.assign(endpoint, { outbox });
        endpoint.configure({ get: (path: string, handler: (req: unknown, res: unknown) => void) => { routes[path] = handler; } } as never);
        return { route: routes[QAAP_TENANT_PUSH_OUTBOX_PATH], outbox };
    }

    function call(route: (req: unknown, res: unknown) => void, headers: Record<string, string>): { status: number, body: unknown } {
        const result: { status: number, body: unknown } = { status: 200, body: undefined };
        const res = {
            statusCode: 200,
            status(code: number) { result.status = code; return res; },
            setHeader: (): void => { /* not asserted */ },
            json(body: unknown) { result.body = body; return res; },
            end(): void { /* empty */ },
        };
        route({ headers, socket: { remoteAddress: '10.0.0.1' } }, res);
        return result;
    }

    it('answers 401 without a valid tenant probe and keeps the queue intact', () => {
        const { route, outbox } = setup();
        outbox.enqueue({ title: 't', body: 'b' });
        expect(call(route, {}).status).to.equal(401);
        expect(call(route, { [QAAP_TENANT_BUSY_PROBE_HEADER]: 'not-a-probe' }).status).to.equal(401);
        expect(outbox.size()).to.equal(1);
    });

    it('drains the queue for a probe signed with this tenant secret', () => {
        const { route, outbox } = setup();
        outbox.enqueue({ title: 'done', body: 'agent finished', tag: 'qaap-agent-done' });
        const probe = QaapTenantBusyProbe.create(LOGIN, SECRET);
        const result = call(route, { [QAAP_TENANT_BUSY_PROBE_HEADER]: probe });
        expect(result.status).to.equal(200);
        expect((result.body as { entries: Array<{ title: string }> }).entries.map(entry => entry.title)).to.deep.equal(['done']);
        expect(outbox.size()).to.equal(0);
    });

    it('refuses a probe signed for another tenant', () => {
        const { route, outbox } = setup();
        outbox.enqueue({ title: 't', body: 'b' });
        const foreign = QaapTenantBusyProbe.create('mallory', SECRET);
        expect(call(route, { [QAAP_TENANT_BUSY_PROBE_HEADER]: foreign }).status).to.equal(401);
        expect(outbox.size()).to.equal(1);
    });

    it('is not served outside tenant-backend mode', () => {
        const { route } = setup();
        delete process.env.QAAP_TENANT_BACKEND_MODE;
        expect(call(route, { [QAAP_TENANT_BUSY_PROBE_HEADER]: QaapTenantBusyProbe.create(LOGIN, SECRET) }).status).to.equal(404);
    });
});
