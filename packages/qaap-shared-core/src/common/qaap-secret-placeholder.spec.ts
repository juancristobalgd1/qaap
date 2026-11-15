// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isQaapSecretPlaceholder,
    maskQaapUserSecretsForClient,
    preferenceIdOfQaapSecretPlaceholder,
    toQaapSecretPlaceholder,
} from './qaap-secret-placeholder';

const OPENROUTER = 'ai-features.openrouter.openrouterApiKey';
const TENANT_ENV = { QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'alice' };

describe('qaap-secret-placeholder', () => {

    it('round-trips a preference id through the placeholder', () => {
        const placeholder = toQaapSecretPlaceholder(OPENROUTER);
        expect(placeholder).to.equal(`qaap-sealed-secret:${OPENROUTER}`);
        expect(isQaapSecretPlaceholder(placeholder)).to.equal(true);
        expect(preferenceIdOfQaapSecretPlaceholder(placeholder)).to.equal(OPENROUTER);
    });

    it('does not treat real keys, empty strings or non-strings as placeholders', () => {
        for (const value of ['test-key-old', '', 'qaap-sealed-secret:', undefined, true, 42]) {
            expect(isQaapSecretPlaceholder(value), String(value)).to.equal(false);
            expect(preferenceIdOfQaapSecretPlaceholder(value), String(value)).to.equal(undefined);
        }
    });

    it('masks allowlisted non-empty secrets on a tenant backend', () => {
        const masked = maskQaapUserSecretsForClient({ [OPENROUTER]: 'test-key-old', 'ai-features.nvidia.nvidiaApiKey': '' }, TENANT_ENV);
        expect(masked[OPENROUTER]).to.equal(toQaapSecretPlaceholder(OPENROUTER));
        expect(masked['ai-features.nvidia.nvidiaApiKey']).to.equal('');
    });

    it('leaves non-allowlisted secrets and plain settings untouched', () => {
        const settings = { 'ai-features.google.apiKey': 'g-real', 'ai-features.openrouter.openrouterBaseUrl': 'https://x' };
        expect(maskQaapUserSecretsForClient(settings, TENANT_ENV)).to.deep.equal(settings);
    });

    it('does not mask outside tenant mode or with QAAP_MASK_USER_SECRETS switched off', () => {
        const settings = { [OPENROUTER]: 'test-key-old' };
        expect(maskQaapUserSecretsForClient(settings, {})).to.deep.equal(settings);
        expect(maskQaapUserSecretsForClient(settings, { QAAP_TENANT_BACKEND_MODE: '1' })).to.deep.equal(settings);
        for (const off of ['0', 'false', 'OFF']) {
            expect(maskQaapUserSecretsForClient(settings, { ...TENANT_ENV, QAAP_MASK_USER_SECRETS: off }), off).to.deep.equal(settings);
        }
    });
});
