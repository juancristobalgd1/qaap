// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { asQaapRepositoryCwd, isQaapWorkspaceContainerPath } from './qaap-workspace-container-path';

describe('qaap-workspace-container-path', () => {

    it('treats every level above a repository as a container', () => {
        const containers = [
            '/workspace',
            '/workspace/',
            '/workspace/repos',
            '/workspace/repos/users',
            '/workspace/repos/users/alice',
            '/workspace/repos/users/alice/acme',
            '/workspace/repos/acme',
            '/home/jc/.qaap/workspaces',
            '/home/jc/.qaap/workspaces/users/alice',
            '/home/jc/.qaap/workspaces/users/alice/acme',
            'D:\\workspace',
            'D:\\workspace\\repos\\users\\alice\\acme',
        ];
        for (const path of containers) {
            expect(isQaapWorkspaceContainerPath(path), path).to.be.true;
        }
    });

    it('accepts a concrete repository in both layouts', () => {
        const repositories = [
            '/workspace/repos/users/alice/acme/widgets',
            '/workspace/repos/users/alice/acme/widgets/packages/core',
            '/workspace/repos/acme/widgets',
            '/home/jc/.qaap/workspaces/users/alice/acme/widgets',
            '/home/jc/.qaap/workspaces/acme/widgets',
            'D:\\workspace\\repos\\users\\alice\\acme\\widgets',
        ];
        for (const path of repositories) {
            expect(isQaapWorkspaceContainerPath(path), path).to.be.false;
        }
    });

    it('does not classify a repository literally named "repos" as a container', () => {
        expect(isQaapWorkspaceContainerPath('/workspace/repos/users/alice/acme/repos')).to.be.false;
    });

    it('leaves unmanaged local dev folders alone', () => {
        expect(isQaapWorkspaceContainerPath('/Users/jc/qaap')).to.be.false;
        expect(isQaapWorkspaceContainerPath('C:\\src\\qaap')).to.be.false;
    });

    it('asQaapRepositoryCwd drops containers and empty input', () => {
        expect(asQaapRepositoryCwd('/workspace')).to.be.undefined;
        expect(asQaapRepositoryCwd('  ')).to.be.undefined;
        expect(asQaapRepositoryCwd(undefined)).to.be.undefined;
        expect(asQaapRepositoryCwd('/workspace/repos/users/alice/acme/widgets')).to.equal('/workspace/repos/users/alice/acme/widgets');
    });
});
