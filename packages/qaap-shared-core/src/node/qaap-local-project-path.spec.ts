// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as path from 'path';
import { isValidLocalProjectName, resolveLocalProjectWorkspacePath } from './qaap-local-project-path';

describe('qaap-local-project-path', () => {
    const reposRoot = path.join('/srv', 'repos');

    describe('isValidLocalProjectName', () => {
        it('accepts plain folder names', () => {
            expect(isValidLocalProjectName('my-app')).to.equal(true);
            expect(isValidLocalProjectName('app_2.0')).to.equal(true);
        });

        it('rejects traversal, separators, hidden names, blanks and overlong names', () => {
            for (const name of ['', '.', '..', '../escape', 'a/b', 'a\\b', '.hidden', 'C:evil', 'with space', 'x'.repeat(101)]) {
                expect(isValidLocalProjectName(name), name).to.equal(false);
            }
        });
    });

    describe('resolveLocalProjectWorkspacePath', () => {
        it('places the folder under the caller local projects directory', () => {
            const target = resolveLocalProjectWorkspacePath(reposRoot, 'octo', 'my-app');
            expect(target).to.equal(path.join(reposRoot, 'users', 'octo', 'local', 'my-app'));
        });

        it('returns undefined for any name that would leave the local directory', () => {
            expect(resolveLocalProjectWorkspacePath(reposRoot, 'octo', '..')).to.equal(undefined);
            expect(resolveLocalProjectWorkspacePath(reposRoot, 'octo', '../other')).to.equal(undefined);
            expect(resolveLocalProjectWorkspacePath(reposRoot, 'octo', '/etc')).to.equal(undefined);
        });

        it('keeps each login in its own repos root', () => {
            const a = resolveLocalProjectWorkspacePath(reposRoot, 'alice', 'app');
            const b = resolveLocalProjectWorkspacePath(reposRoot, 'bob', 'app');
            expect(a).to.not.equal(b);
            expect(a?.startsWith(path.join(reposRoot, 'users', 'alice') + path.sep)).to.equal(true);
        });
    });
});
