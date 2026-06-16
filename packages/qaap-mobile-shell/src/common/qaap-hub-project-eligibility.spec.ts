// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isUserRepositoryFilesystemPath,
    isValidHubUserRepositoryProjectCandidate,
    isVpsWorkspaceInfrastructurePath,
} from './qaap-hub-project-eligibility';

describe('qaap-hub-project-eligibility', () => {

    it('treats the VPS workspace mount and infra folders as non-repositories', () => {
        expect(isVpsWorkspaceInfrastructurePath('/workspace')).to.be.true;
        expect(isVpsWorkspaceInfrastructurePath('/workspace/repos')).to.be.true;
        expect(isVpsWorkspaceInfrastructurePath('/workspace/.qaap')).to.be.true;
        expect(isVpsWorkspaceInfrastructurePath('/workspace/.theia')).to.be.true;
        expect(isUserRepositoryFilesystemPath('/workspace')).to.be.false;
        expect(isUserRepositoryFilesystemPath('/workspace/repos')).to.be.false;
    });

    it('accepts cloned GitHub repos under /workspace/repos/owner/name', () => {
        expect(isUserRepositoryFilesystemPath('/workspace/repos/acme/Lavadiario')).to.be.true;
        expect(isUserRepositoryFilesystemPath('/workspace/repos/acme/esor-vite/')).to.be.true;
    });

    it('accepts local dev workspaces under ~/.qaap/workspaces/owner/name', () => {
        expect(isUserRepositoryFilesystemPath('/Users/jc/.qaap/workspaces/acme/demo')).to.be.true;
    });

    it('rejects partial paths and nested repo paths', () => {
        expect(isUserRepositoryFilesystemPath('/workspace/repos/acme')).to.be.false;
        expect(isUserRepositoryFilesystemPath('/workspace/repos/acme/demo/nested')).to.be.false;
    });

    it('isValidHubUserRepositoryProjectCandidate prefers github metadata over filesystem path', () => {
        expect(isValidHubUserRepositoryProjectCandidate({
            hasGithub: true,
            filesystemPath: '/workspace',
        })).to.be.true;
        expect(isValidHubUserRepositoryProjectCandidate({
            hasGithub: false,
            filesystemPath: '/workspace/repos/acme/demo',
        })).to.be.true;
        expect(isValidHubUserRepositoryProjectCandidate({
            hasGithub: false,
            filesystemPath: '/workspace',
        })).to.be.false;
    });
});
