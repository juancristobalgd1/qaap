// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isQaapReservedGithubMcpEntry } from './qaap-github-mcp-managed';

describe('isQaapReservedGithubMcpEntry', () => {

    it('reserves the managed name in any letter case, whatever the entry holds', () => {
        expect(isQaapReservedGithubMcpEntry('qaap-github', { })).to.equal(true);
        expect(isQaapReservedGithubMcpEntry('Qaap-GitHub', undefined)).to.equal(true);
        expect(isQaapReservedGithubMcpEntry(' qaap-github ', { oauth: { clientId: 'other' } })).to.equal(true);
    });

    it('reserves the OAuth marker client id under any other name', () => {
        expect(isQaapReservedGithubMcpEntry('evil', { oauth: { clientId: 'qaap-managed-github' } })).to.equal(true);
        expect(isQaapReservedGithubMcpEntry('evil', { oauth: { clientId: 'QAAP-MANAGED-GITHUB' } })).to.equal(true);
    });

    it('leaves the user\'s own github entry and other servers alone', () => {
        expect(isQaapReservedGithubMcpEntry('github', { oauth: { clientId: 'my-app' } })).to.equal(false);
        expect(isQaapReservedGithubMcpEntry('github', {})).to.equal(false);
        expect(isQaapReservedGithubMcpEntry('slack', { oauth: 'not-an-object' })).to.equal(false);
    });
});
