// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapGithubOwnerTokenCache } from './qaap-github-owner-token-cache';

describe('QaapGithubOwnerTokenCache', () => {

    it('keeps the latest token per login, case-insensitively', () => {
        const cache = new QaapGithubOwnerTokenCache();
        cache.remember('Alice', 'gho_one', 1);
        cache.remember('alice', 'gho_two', 2);
        expect(cache.get('ALICE', 3)).to.equal('gho_two');
        expect(cache.get('bob', 3)).to.equal(undefined);
        expect(cache.get(undefined, 3)).to.equal(undefined);
    });

    it('expires a token that was not refreshed by a request for 12 hours', () => {
        const cache = new QaapGithubOwnerTokenCache();
        cache.remember('alice', 'gho_one', 0);
        expect(cache.get('alice', 12 * 60 * 60 * 1000)).to.equal('gho_one');
        expect(cache.get('alice', 12 * 60 * 60 * 1000 + 1)).to.equal(undefined);
    });

    it('forgets a token GitHub rejected, but not a newer one', () => {
        const cache = new QaapGithubOwnerTokenCache();
        cache.remember('alice', 'gho_new');
        cache.forget('alice', 'gho_old');
        expect(cache.get('alice')).to.equal('gho_new');
        cache.forget('alice', 'gho_new');
        expect(cache.get('alice')).to.equal(undefined);
    });
});
