// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { findProjectMatchingWorkspaceCwd } from './qaap-composer-workspace-project';

describe('qaap-composer-workspace-project', () => {

    it('findProjectMatchingWorkspaceCwd ignores stale isCurrent when cwd differs', () => {
        type Row = { id: string; isCurrent?: boolean; cwd?: string };
        const projects: Row[] = [
            { id: 'mockup', isCurrent: true, cwd: '/Users/jc/.qaap/workspaces/u/Mockup' },
            { id: 'other', cwd: '/tmp/other' },
        ];
        const getCwd = (p: Row) => p.cwd;
        const matches = (p: Row) => p.id === 'temp';
        expect(findProjectMatchingWorkspaceCwd(projects, '/tmp/qaap-ui-ws-abc', getCwd, matches)).to.be.undefined;
    });

    it('findProjectMatchingWorkspaceCwd prefers isCurrent, then match key, then cwd equality', () => {
        type Row = { id: string; isCurrent?: boolean; cwd?: string };
        const projects: Row[] = [
            { id: 'mockup', cwd: '/Users/jc/.qaap/workspaces/u/Mockup' },
            { id: 'other', cwd: '/tmp/other' },
        ];
        const getCwd = (p: Row) => p.cwd;
        const matches = (p: Row) => p.id === 'temp';

        expect(findProjectMatchingWorkspaceCwd(projects, '/tmp/qaap-ui-ws-abc', getCwd, matches)).to.be.undefined;

        const withCurrent = [{ id: 'temp', isCurrent: true, cwd: '/tmp/qaap-ui-ws-abc' }, ...projects];
        expect(findProjectMatchingWorkspaceCwd(withCurrent, '/tmp/qaap-ui-ws-abc', getCwd, matches)?.id).to.equal('temp');

        const byCwd = [{ id: 'ephemeral', cwd: '/tmp/qaap-ui-ws-abc' }, ...projects];
        expect(findProjectMatchingWorkspaceCwd(byCwd, '/tmp/qaap-ui-ws-abc', getCwd, matches)?.id).to.equal('ephemeral');
    });
});
