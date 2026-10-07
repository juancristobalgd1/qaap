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

describe('QaapProjectSessionStore removed repositories', () => {

    it('remembers a removed GitHub repository per user, whatever the case, until it is cleared', () => {
        const store = new InMemoryProjectSessionStore();
        store.markRepositoryRemoved('alice', 'github:Acme/Shop');

        expect(store.isRepositoryRemoved('alice', 'github:acme/shop')).to.equal(true);
        expect(store.isRepositoryRemoved('bob', 'github:acme/shop')).to.equal(false);
        expect(store.isRepositoryRemoved('alice', 'github:acme/blog')).to.equal(false);

        expect(store.clearRepositoryRemoved('alice', 'github:ACME/shop')).to.equal(true);
        expect(store.isRepositoryRemoved('alice', 'github:acme/shop')).to.equal(false);
    });
});

// Production (juancristobalgd1, Oct 7 2026): the removal was recorded under `github:owner/repo`, but the
// project's path-keyed sessions (`recent:file:///…`, `ws:file:///…`) survived and listed it again.
describe('QaapProjectSessionStore removed repositories and path-keyed sessions', () => {

    const login = 'juancristobalgd1';
    const clone = 'file:///workspace/repos/users/juancristobalgd1/juancristobalgd1/vyyq';

    it('treats ws:, recent:, file: and cwd keys of a removed clone as removed', () => {
        const store = new InMemoryProjectSessionStore();
        store.markRepositoryRemoved(login, 'github:juancristobalgd1/vyyq');

        expect(store.isRepositoryRemoved(login, `ws:${clone}`)).to.equal(true);
        expect(store.isRepositoryRemoved(login, `recent:${clone}`)).to.equal(true);
        expect(store.isRepositoryRemoved(login, clone)).to.equal(true);
        expect(store.isRepositoryRemoved(login, '/workspace/repos/users/juancristobalgd1/juancristobalgd1/vyyq/web')).to.equal(true);
        expect(store.isRepositoryRemoved(login, 'ws:file:///workspace/repos/users/juancristobalgd1/juancristobalgd1/other')).to.equal(false);
    });

    it('does not list path-keyed sessions of a removed repository', () => {
        const store = new InMemoryProjectSessionStore();
        store.upsertForUser(login, { repoKey: `recent:${clone}`, agentState: 'working', lastTask: 'Starting dev server…', previewUrl: 'https://preview.example/vyyq' });
        store.upsertForUser(login, { repoKey: `ws:${clone}` });
        store.upsertForUser(login, { repoKey: 'github:juancristobalgd1/other' });
        store.markRepositoryRemoved(login, 'github:juancristobalgd1/vyyq');

        expect(store.listForUser(login).map(session => session.repoKey)).to.deep.equal(['github:juancristobalgd1/other']);
    });

    it('deletes every session of the repository, whatever key the hub used', () => {
        const store = new InMemoryProjectSessionStore();
        store.upsertForUser(login, { repoKey: `recent:${clone}` });
        store.upsertForUser(login, { repoKey: `ws:${clone}` });
        store.upsertForUser(login, { repoKey: 'github:JuanCristobalGD1/vyyq' });
        store.upsertForUser(login, { repoKey: 'github:juancristobalgd1/other' });

        expect(store.deleteForUser(login, 'github:juancristobalgd1/vyyq')).to.equal(true);

        expect(store.listForUser(login).map(session => session.repoKey)).to.deep.equal(['github:juancristobalgd1/other']);
    });
});
