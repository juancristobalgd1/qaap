// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as path from 'path';
import {
    isQaapTenantConfigPath,
    resolveQaapTenantConfigDir,
    resolveQaapTenantConfigRoot,
} from './qaap-tenant-config-scope';

describe('qaap-tenant-config-scope', () => {
    it('derives distinct Theia storage directories for distinct tenants', () => {
        const alice = resolveQaapTenantConfigDir('alice');
        const bob = resolveQaapTenantConfigDir('bob');

        expect(alice).to.not.equal(bob);
        expect(alice).to.contain(path.join('users', 'alice', 'theia'));
        expect(bob).to.contain(path.join('users', 'bob', 'theia'));
        expect(isQaapTenantConfigPath(alice)).to.equal(true);
        expect(isQaapTenantConfigPath(bob)).to.equal(true);
    });

    it('sanitizes a login as one path segment and rejects the shared parent as a tenant directory', () => {
        const escaped = resolveQaapTenantConfigDir('../bob');
        const root = resolveQaapTenantConfigRoot();

        expect(path.dirname(path.dirname(escaped))).to.equal(path.resolve(root));
        expect(escaped).to.not.equal(path.resolve(root, 'bob', 'theia'));
        expect(isQaapTenantConfigPath(path.resolve(root, 'bob', 'theia'))).to.equal(true);
    });

    it('rejects an empty owner login', () => {
        expect(() => resolveQaapTenantConfigDir('   ')).to.throw('without an owner login');
    });
});
