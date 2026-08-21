// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as path from 'path';
import {
    normalizeIsolationPath,
    parseGithubFullNameFromWorkspacePath,
    resolveTenantIsolationRoot,
    resolveTenantSegmentFromWorkspacePath,
} from './qaap-user-isolation';

describe('normalizeIsolationPath (cross-OS)', () => {
    it('posix host: rewrites Windows-browser FileUri.fsPath mangling of POSIX URIs', () => {
        expect(normalizeIsolationPath('/\\workspace\\repos\\users\\alice\\acme\\site', 'posix'))
            .to.equal('/workspace/repos/users/alice/acme/site');
        expect(normalizeIsolationPath('/workspace\\repos\\users\\alice\\acme\\site', 'posix'))
            .to.equal('/workspace/repos/users/alice/acme/site');
    });

    it('posix host: accepts file: URIs (Linux/macOS workspaces)', () => {
        expect(normalizeIsolationPath('file:///workspace/repos/users/alice/acme/site', 'posix'))
            .to.equal('/workspace/repos/users/alice/acme/site');
        expect(normalizeIsolationPath('file:///Users/me/.qaap/workspaces/users/_dev/o/r', 'posix'))
            .to.equal('/Users/me/.qaap/workspaces/users/_dev/o/r');
    });

    it('win32 host: preserves drive-letter paths and unifies separators', () => {
        expect(normalizeIsolationPath('C:\\Users\\me\\.qaap\\workspaces\\users\\alice\\o\\r', 'win32'))
            .to.equal('C:\\Users\\me\\.qaap\\workspaces\\users\\alice\\o\\r');
        expect(normalizeIsolationPath('C:/Users/me/.qaap/workspaces/users/alice/o/r', 'win32'))
            .to.equal('C:\\Users\\me\\.qaap\\workspaces\\users\\alice\\o\\r');
        expect(normalizeIsolationPath('file:///C:/Users/me/.qaap/workspaces/users/alice/o/r', 'win32'))
            .to.equal('C:\\Users\\me\\.qaap\\workspaces\\users\\alice\\o\\r');
    });

    it('win32 host: does not treat "/\\workspace\\..." mangling as a UNC share', () => {
        // Must become C:\workspace\... (or equivalent), not \\workspace\repos\...
        const normalized = normalizeIsolationPath('/\\workspace\\repos\\users\\alice\\o\\r', 'win32');
        expect(normalized.toLowerCase().replace(/\//g, '\\')).to.match(/^([a-z]:\\)?workspace\\repos\\users\\alice\\o\\r$/i);
        expect(normalized.startsWith('\\\\')).to.equal(false);
    });

    it('falls back when path.posix is null (browser webpack)', () => {
        const descriptor = Object.getOwnPropertyDescriptor(path, 'posix');
        Object.defineProperty(path, 'posix', { value: null, configurable: true, writable: true });
        try {
            expect(normalizeIsolationPath('/workspace\\repos\\users\\alice\\site', 'posix'))
                .to.equal('/workspace/repos/users/alice/site');
        } finally {
            if (descriptor) {
                Object.defineProperty(path, 'posix', descriptor);
            }
        }
    });
});

describe('resolveTenantSegmentFromWorkspacePath', () => {
    const reposRoot = '/workspace/repos';

    it('extracts the tenant segment from a repo cwd (posix)', () => {
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/repos/users/alice/acme/site', 'posix'))
            .to.equal('alice');
    });

    it('extracts the segment when cwd uses Windows backslashes on a posix host', () => {
        expect(resolveTenantSegmentFromWorkspacePath(
            reposRoot,
            '/\\workspace\\repos\\users\\juancristobalgd1\\juancristobalgd1\\qaap',
            'posix',
        )).to.equal('juancristobalgd1');
    });

    it('extracts the segment on a Windows host under a drive letter', () => {
        expect(resolveTenantSegmentFromWorkspacePath(
            'C:\\Users\\me\\.qaap\\workspaces',
            'C:\\Users\\me\\.qaap\\workspaces\\users\\alice\\acme\\site',
            'win32',
        )).to.equal('alice');
        expect(resolveTenantSegmentFromWorkspacePath(
            'C:/Users/me/.qaap/workspaces',
            'C:/Users/me/.qaap/workspaces/users/alice/acme/site',
            'win32',
        )).to.equal('alice');
    });

    it('returns the segment for the tenant root itself', () => {
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/repos/users/alice', 'posix')).to.equal('alice');
    });

    it('returns the reserved bucket segment verbatim', () => {
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/repos/users/_anonymous/o/r', 'posix'))
            .to.equal('_anonymous');
    });

    it('returns undefined for the users container itself (no tenant segment)', () => {
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/repos/users', 'posix')).to.equal(undefined);
    });

    it('returns undefined for paths outside the per-user tree', () => {
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/repos', 'posix')).to.equal(undefined);
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/tmp/somewhere', 'posix')).to.equal(undefined);
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/other/users/alice', 'posix')).to.equal(undefined);
    });

    it('does not escape the users root via traversal', () => {
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/repos/users/../secret', 'posix')).to.equal(undefined);
    });
});

describe('resolveTenantIsolationRoot with mangled separators', () => {
    it('recognizes a Windows-mangled tenant cwd on a posix host (VPS)', () => {
        const target = resolveTenantIsolationRoot(
            '/workspace/repos',
            '/tmp/qaap-worktrees',
            '/\\workspace\\repos\\users\\alice\\acme\\site',
            'posix',
        );
        expect(target?.segment).to.equal('alice');
        expect(target?.root).to.equal('/workspace/repos/users/alice');
    });

    it('recognizes a native Windows tenant cwd', () => {
        const target = resolveTenantIsolationRoot(
            'C:\\Users\\me\\.qaap\\workspaces',
            'C:\\Users\\me\\AppData\\Local\\Temp\\qaap-worktrees',
            'C:\\Users\\me\\.qaap\\workspaces\\users\\alice\\acme\\site',
            'win32',
        );
        expect(target?.segment).to.equal('alice');
        expect(target?.root).to.equal('C:\\Users\\me\\.qaap\\workspaces\\users\\alice');
    });
});

describe('parseGithubFullNameFromWorkspacePath', () => {
    it('parses canonical per-user repository paths', () => {
        expect(parseGithubFullNameFromWorkspacePath('/workspace/repos/users/alice/acme/site'))
            .to.equal('acme/site');
    });

    it('parses legacy repository paths that encode owner and repository', () => {
        expect(parseGithubFullNameFromWorkspacePath('/workspace/repos/acme/site'))
            .to.equal('acme/site');
    });

    it('does not invent an owner for ambiguous legacy per-user paths', () => {
        expect(parseGithubFullNameFromWorkspacePath('/workspace/repos/users/alice/site'))
            .to.equal(undefined);
    });
});
