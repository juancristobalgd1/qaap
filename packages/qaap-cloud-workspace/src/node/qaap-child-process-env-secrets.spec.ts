// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { childProcessEnv, isQaapBackendOnlyEnvKey } from './qaap-child-process-env';

describe('qaap-child-process-env (QAAP_SECRETS_KEYS)', () => {
    it('flags the at-rest master key as backend-only', () => {
        expect(isQaapBackendOnlyEnvKey('QAAP_SECRETS_KEYS')).to.equal(true);
    });

    it('never hands the at-rest master key to agent processes', () => {
        const env = childProcessEnv({ QAAP_SECRETS_KEYS: 'k1:c2VjcmV0', PATH: '/usr/bin', QAAP_TASK_TOKEN: 'helper' });
        expect(env).not.to.have.property('QAAP_SECRETS_KEYS');
        expect(env.PATH).to.equal('/usr/bin');
        expect(env.QAAP_TASK_TOKEN).to.equal('helper');
    });

    it('never hands the VAPID private key or subject to agent processes, but keeps the public key', () => {
        const env = childProcessEnv({
            QAAP_VAPID_PRIVATE_KEY: 'priv-b64url',
            QAAP_VAPID_SUBJECT: 'mailto:ops@example.com',
            QAAP_VAPID_PUBLIC_KEY: 'pub-b64url',
            PATH: '/usr/bin',
        });
        expect(env).not.to.have.property('QAAP_VAPID_PRIVATE_KEY');
        expect(env).not.to.have.property('QAAP_VAPID_SUBJECT');
        expect(env.QAAP_VAPID_PUBLIC_KEY).to.equal('pub-b64url');
        expect(env.PATH).to.equal('/usr/bin');
    });
});
