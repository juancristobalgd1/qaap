// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    cwdIsGitRepository,
    parseGithubRepoFromCwd,
    parseGithubRepoFromRemoteUrl,
} from './qaap-agent-conversation-store-git';

describe('parseGithubRepoFromRemoteUrl', () => {

    it('parses https remotes without truncating a repo whose name contains "git"', () => {
        expect(parseGithubRepoFromRemoteUrl('https://github.com/juancristobalgd1/qaap.git'))
            .to.deep.equal({ owner: 'juancristobalgd1', name: 'qaap' });
        expect(parseGithubRepoFromRemoteUrl('https://github.com/juancristobalgd1/qaap'))
            .to.deep.equal({ owner: 'juancristobalgd1', name: 'qaap' });
    });

    it('parses ssh remotes', () => {
        expect(parseGithubRepoFromRemoteUrl('git@github.com:antfu-collective/vitesse-lite.git'))
            .to.deep.equal({ owner: 'antfu-collective', name: 'vitesse-lite' });
    });

    it('rejects non-GitHub hosts', () => {
        expect(parseGithubRepoFromRemoteUrl('https://gitlab.com/acme/app.git')).to.equal(undefined);
    });
});

describe('parseGithubRepoFromCwd', () => {

    it('does not walk into a parent git repository', () => {
        const nested = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-nongit-cwd-'));
        try {
            expect(cwdIsGitRepository(nested)).to.equal(false);
            expect(parseGithubRepoFromCwd(nested)).to.equal(undefined);
        } finally {
            fs.rmSync(nested, { recursive: true, force: true });
        }
    });
});
