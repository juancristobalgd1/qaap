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

    it('keeps the open hub project when several projects exist and none is selected', () => {
        expect(planDesktopIdeWorkspaceOpen(
            [
                { id: 'a', cwd: '/workspace/repos/users/alice/acme/a' },
                { id: 'b', cwd: '/workspace/repos/users/alice/acme/b' },
            ],
            '/workspace/repos/users/alice/acme/b',
        )).to.deep.equal({ kind: 'open-project', projectIndex: 1 });
    });

    it('reloads to an empty IDE when several projects exist and a repo outside the hub is open', () => {
        expect(planDesktopIdeWorkspaceOpen(
            [
                { id: 'a', cwd: '/workspace/repos/users/alice/acme/a' },
                { id: 'b', cwd: '/workspace/repos/users/alice/acme/b' },
            ],
            '/workspace/repos/users/alice/acme/other',
        )).to.deep.equal({ kind: 'reload-empty' });
    });

    it('opens the most recent project when several exist and no repository is open yet', () => {
        // Hosted Work Hub has no workspace root; the header then shows the first project.
        expect(planDesktopIdeWorkspaceOpen(
            [{ id: 'a' }, { id: 'b' }],
            undefined,
        )).to.deep.equal({ kind: 'open-project', projectIndex: 0 });
    });

    it('opens the pinned project when several exist and the cwd is only a container', () => {
        expect(planDesktopIdeWorkspaceOpen(
            [{ id: 'a' }, { id: 'b', pinned: true }],
            '/workspace',
        )).to.deep.equal({ kind: 'open-project', projectIndex: 1 });
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
            [{ id: 'a', cwd: '/ws/a' }, { id: 'b', cwd: '/ws/b' }],
            '/ws/b',
            'missing',
        )).to.deep.equal({ kind: 'open-project', projectIndex: 1 });
    });

    it('matches the shown project by cwd when the fresh list gives it another id', () => {
        expect(planDesktopIdeWorkspaceOpen(
            [
                { id: 'recent:file:///workspace/repos/users/alice/acme/vitesse-lite', cwd: '/workspace/repos/users/alice/acme/vitesse-lite' },
                { id: 'recent:file:///workspace/repos/users/alice/acme/shadcn', cwd: '/workspace/repos/users/alice/acme/shadcn' },
            ],
            undefined,
            { id: 'github:acme/shadcn', cwd: '/workspace/repos/users/alice/acme/shadcn/' },
        )).to.deep.equal({ kind: 'open-project', projectIndex: 1 });
    });

    it('matches the shown project by GitHub full name when it has no cwd yet', () => {
        expect(planDesktopIdeWorkspaceOpen(
            [
                { id: 'recent:a', cwd: '/ws/a', githubFullName: 'acme/a' },
                { id: 'recent:shadcn', cwd: '/ws/shadcn', githubFullName: 'Acme/Shadcn' },
            ],
            undefined,
            { id: 'github:acme/shadcn', githubFullName: 'acme/shadcn' },
        )).to.deep.equal({ kind: 'open-project', projectIndex: 1 });
    });

    it('compares cwds regardless of trailing slashes and Windows separators', () => {
        expect(planDesktopIdeWorkspaceOpen(
            [{ id: 'a', cwd: 'C:\\ws\\a' }, { id: 'b', cwd: 'C:\\ws\\b' }],
            'C:/ws/b/',
        )).to.deep.equal({ kind: 'open-project', projectIndex: 1 });
    });
});
