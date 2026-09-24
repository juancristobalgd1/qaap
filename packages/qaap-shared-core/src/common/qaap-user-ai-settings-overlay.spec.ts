// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { shouldInterceptSharedUserAiPrefWrites } from './qaap-user-ai-settings-overlay';

describe('Qaap user AI settings overlay', () => {

    it('intercepts writes for authenticated GitHub/GitLab logins', () => {
        expect(shouldInterceptSharedUserAiPrefWrites('alice')).to.equal(true);
        expect(shouldInterceptSharedUserAiPrefWrites('bob-org')).to.equal(true);
    });

    it('keeps shared User scope for skip-auth and anonymous buckets', () => {
        expect(shouldInterceptSharedUserAiPrefWrites(undefined)).to.equal(false);
        expect(shouldInterceptSharedUserAiPrefWrites('')).to.equal(false);
        expect(shouldInterceptSharedUserAiPrefWrites('_dev')).to.equal(false);
        expect(shouldInterceptSharedUserAiPrefWrites('_anonymous')).to.equal(false);
    });
});
