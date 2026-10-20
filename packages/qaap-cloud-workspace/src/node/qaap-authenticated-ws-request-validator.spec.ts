// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import type { QaapGithubAuthContext } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { QaapAuthenticatedWsRequestValidator } from './qaap-authenticated-ws-request-validator';

describe('QaapAuthenticatedWsRequestValidator', () => {
    const savedEnv = {
        NODE_ENV: process.env.NODE_ENV,
        QAAP_CLOUD_MODE: process.env.QAAP_CLOUD_MODE,
        QAAP_TENANT_BACKEND_MODE: process.env.QAAP_TENANT_BACKEND_MODE,
    };

    afterEach(() => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    function createValidator(context: QaapGithubAuthContext, events: string[] = []): QaapAuthenticatedWsRequestValidator {
        const validator = new QaapAuthenticatedWsRequestValidator();
        (validator as unknown as { auth: unknown }).auth = {
            authenticate: () => context,
            logSecurityEvent: (event: string) => events.push(event),
        };
        return validator;
    }

    function handshake(): http.IncomingMessage {
        return { url: '/socket.io/?EIO=4&transport=polling', headers: { cookie: 'theia-connection-token=anyone' } } as http.IncomingMessage;
    }

    function setHosted(hosted: boolean): void {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_TENANT_BACKEND_MODE;
        if (hosted) {
            process.env.QAAP_CLOUD_MODE = 'docker';
        } else {
            delete process.env.QAAP_CLOUD_MODE;
        }
    }

    it('refuses an unauthenticated handshake in a hosted runtime, even with the connection token', () => {
        setHosted(true);
        const events: string[] = [];
        expect(createValidator({ kind: 'unauthorized' }, events).allowWsUpgrade(handshake())).to.equal(false);
        expect(events).to.deep.equal(['websocket_denied']);
    });

    it('accepts a signed-in caller (session cookie or tenant assertion) in a hosted runtime', () => {
        setHosted(true);
        const context = {
            kind: 'authenticated', userLogin: 'alice', sessionId: 's',
            session: { accessToken: 't', user: { provider: 'github', login: 'alice', name: 'Alice' } },
        } as QaapGithubAuthContext;
        expect(createValidator(context).allowWsUpgrade(handshake())).to.equal(true);
    });

    it('treats NODE_ENV=production as hosted', () => {
        setHosted(false);
        process.env.NODE_ENV = 'production';
        expect(createValidator({ kind: 'unauthorized' }).allowWsUpgrade(handshake())).to.equal(false);
    });

    it('treats a tenant backend as hosted although it runs with NODE_ENV=development and QAAP_CLOUD_MODE=local', () => {
        setHosted(false);
        process.env.NODE_ENV = 'development';
        process.env.QAAP_CLOUD_MODE = 'local';
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        expect(createValidator({ kind: 'unauthorized' }).allowWsUpgrade(handshake())).to.equal(false);
    });

    it('keeps local mode unchanged, signed in or not', () => {
        setHosted(false);
        expect(createValidator({ kind: 'unauthorized' }).allowWsUpgrade(handshake())).to.equal(true);
        expect(createValidator({ kind: 'skip', userLogin: '_dev' }).allowWsUpgrade(handshake())).to.equal(true);
    });
});
