// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { EnvVariable } from '@theia/core/lib/common/env-variables';
import { filterQaapFrontendEnvironment, isQaapSensitiveEnvKey } from './qaap-env-variables';

describe('qaap-env-variables', () => {
    it('recognizes common backend secret and control-plane variables', () => {
        expect(isQaapSensitiveEnvKey('QAAP_GITHUB_CLIENT_SECRET')).to.equal(true);
        expect(isQaapSensitiveEnvKey('QAAP_VAPID_PRIVATE_KEY')).to.equal(true);
        expect(isQaapSensitiveEnvKey('OPENAI_API_KEY')).to.equal(true);
        expect(isQaapSensitiveEnvKey('QAAP_TASK_TOKEN')).to.equal(true);
        expect(isQaapSensitiveEnvKey('DOCKER_HOST')).to.equal(true);
        expect(isQaapSensitiveEnvKey('PATH')).to.equal(false);
        expect(isQaapSensitiveEnvKey('QAAP_PUBLIC_ORIGIN')).to.equal(false);
    });

    it('preserves safe variables without exposing sensitive entries', () => {
        const variables: EnvVariable[] = [
            { name: 'PATH', value: '/usr/bin' },
            { name: 'QAAP_PUBLIC_ORIGIN', value: 'https://qaap.example' },
            { name: 'OPENROUTER_API_KEY', value: 'secret' },
            { name: 'DOCKER_HOST', value: 'unix:///run/user/1000/docker.sock' },
        ];

        expect(filterQaapFrontendEnvironment(variables)).to.deep.equal([
            { name: 'PATH', value: '/usr/bin' },
            { name: 'QAAP_PUBLIC_ORIGIN', value: 'https://qaap.example' },
        ]);
    });
});
