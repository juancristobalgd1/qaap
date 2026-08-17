// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { planDesktopIdeWorkspaceOpen } from './qaap-desktop-ide-workspace-plan';

describe('planDesktopIdeWorkspaceOpen', () => {
    it('opens the sole hub project when only one exists', () => {
        expect(planDesktopIdeWorkspaceOpen(
            [{ id: 'github:acme/demo', cwd: '/workspace/repos/users/alice/acme/demo' }],
            undefined,
        )).to.deep.equal({ kind: 'open-project', projectIndex: 0 });
    });

    it('reloads to an empty IDE when several projects exist and a repo is already open', () => {
        expect(planDesktopIdeWorkspaceOpen(
            [
                { id: 'a', cwd: '/workspace/repos/users/alice/acme/a' },
                { id: 'b', cwd: '/workspace/repos/users/alice/acme/b' },
            ],
            '/workspace/repos/users/alice/acme/a',
        )).to.deep.equal({ kind: 'reload-empty' });
    });

    it('keeps the IDE empty when several projects exist and no repository is open yet', () => {
        expect(planDesktopIdeWorkspaceOpen(
            [{ id: 'a' }, { id: 'b' }],
            undefined,
        )).to.deep.equal({ kind: 'proceed' });
    });

    it('does not reload when several projects exist but the cwd is only a container', () => {
        expect(planDesktopIdeWorkspaceOpen(
            [{ id: 'a' }, { id: 'b' }],
            '/workspace',
        )).to.deep.equal({ kind: 'proceed' });
    });

    it('opens the pinned hub project when several exist', () => {
        expect(planDesktopIdeWorkspaceOpen(
            [
                { id: 'github:typicode/json-server', cwd: '/ws/json-server' },
                { id: 'github:antfu-collective/vitesse-lite', cwd: '/ws/vitesse-lite' },
            ],
            undefined,
            'github:antfu-collective/vitesse-lite',
        )).to.deep.equal({ kind: 'open-project', projectIndex: 1 });
    });

    it('opens the pinned project instead of emptying the IDE when another repo is already open', () => {
        expect(planDesktopIdeWorkspaceOpen(
            [
                { id: 'a', cwd: '/workspace/repos/users/alice/acme/a' },
                { id: 'b', cwd: '/workspace/repos/users/alice/acme/b' },
            ],
            '/workspace/repos/users/alice/acme/a',
            'b',
        )).to.deep.equal({ kind: 'open-project', projectIndex: 1 });
    });

    it('falls back to the multi-project plan when the selected id is unknown', () => {
        expect(planDesktopIdeWorkspaceOpen(
            [{ id: 'a' }, { id: 'b' }],
            undefined,
            'missing',
        )).to.deep.equal({ kind: 'proceed' });
    });
});
