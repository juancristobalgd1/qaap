// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapProjectSessionStore } from './qaap-project-session-store';

class InMemoryProjectSessionStore extends QaapProjectSessionStore {
    protected override schedulePersist(): void {
        /* no disk in unit tests */
    }
}

describe('QaapProjectSessionStore.deleteForUser', () => {

    it('removes a GitHub session whatever the case of owner/repo, and only for that user', () => {
        const store = new InMemoryProjectSessionStore();
        store.upsertForUser('alice', { repoKey: 'github:Acme/Shop' });
        store.upsertForUser('alice', { repoKey: 'github:acme/blog' });
        store.upsertForUser('bob', { repoKey: 'github:Acme/Shop' });

        expect(store.deleteForUser('alice', 'github:acme/shop')).to.equal(true);

        expect(store.listForUser('alice').map(session => session.repoKey)).to.deep.equal(['github:acme/blog']);
        expect(store.listForUser('bob').map(session => session.repoKey)).to.deep.equal(['github:Acme/Shop']);
        expect(store.deleteForUser('alice', 'github:acme/shop')).to.equal(false);
    });
});
