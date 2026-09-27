// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QaapGitProgressParser,
    describeRepositoryImportFailure,
    redactGitCredentials,
    summarizeGitFailure,
    type QaapWorkspaceProgressUpdate,
} from './qaap-git-clone-progress';

describe('QaapGitProgressParser', () => {

    function parse(mode: 'clone' | 'fetch', ...chunks: string[]): QaapWorkspaceProgressUpdate[] {
        const updates: QaapWorkspaceProgressUpdate[] = [];
        const parser = new QaapGitProgressParser(mode, update => updates.push(update));
        chunks.forEach(chunk => parser.push(chunk));
        return updates;
    }

    it('maps receiving objects into the cloning window', () => {
        const updates = parse('clone', 'Cloning into \'.qaap-clone-r-1\'...\n', 'Receiving objects:  50% (500/1000), 1.00 MiB | 2.00 MiB/s\r');
        const last = updates[updates.length - 1];
        expect(last.phase).to.equal('cloning');
        expect(last.percent).to.equal(Math.round(10 + (75 - 10) * 0.5));
        expect(last.detail).to.equal('Receiving objects:  50% (500/1000), 1.00 MiB | 2.00 MiB/s');
    });

    it('handles progress split across chunks and carriage-return redraws', () => {
        const updates = parse('clone', 'Receiving obj', 'ects:  10% (1/10)\rReceiving objects:  20% (2/10)\r');
        expect(updates.map(update => update.percent)).to.include(Math.round(10 + 65 * 0.2));
    });

    it('never moves backwards when a late remote line arrives', () => {
        const updates = parse('clone', 'Resolving deltas: 50% (1/2)\r', 'remote: Counting objects: 100% (5/5), done.\n');
        const percents = updates.map(update => update.percent ?? 0);
        expect(percents[1]).to.be.at.least(percents[0]);
    });

    it('reports the checkout stage as checking-out', () => {
        const updates = parse('clone', 'Updating files:  40% (4/10)\r');
        expect(updates[0].phase).to.equal('checking-out');
    });

    it('uses the fetching phase for fetch', () => {
        const updates = parse('fetch', 'Receiving objects: 100% (3/3), done.\n');
        expect(updates[0].phase).to.equal('fetching');
        expect(updates[0].percent).to.equal(80);
        expect(updates[0].detail).to.equal('Receiving objects: 100% (3/3)');
    });

    it('ignores unrelated stderr lines', () => {
        expect(parse('clone', 'warning: something\n', 'hint: foo\n')).to.deep.equal([]);
    });
});

describe('git credential redaction', () => {

    it('removes userinfo from URLs, authorization headers and GitHub tokens', () => {
        const text = redactGitCredentials(
            'fatal: unable to access \'https://x-access-token:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r.git/\': '
            + 'AUTHORIZATION: basic eC1hY2Nlc3MtdG9rZW46Z2hw github_pat_ABCDEFGHIJKLMNOPQRSTUV_123'
        );
        expect(text).to.not.contain('ghp_');
        expect(text).to.not.contain('github_pat_');
        expect(text).to.not.contain('eC1hY2Nlc3M');
        expect(text).to.contain('https://***@github.com/o/r.git/');
    });
});

describe('summarizeGitFailure', () => {

    it('drops progress noise and prefers fatal lines', () => {
        const stderr = [
            'Cloning into \'x\'...',
            'remote: Enumerating objects: 10, done.',
            'Receiving objects:  45% (450/1000)\rReceiving objects:  46% (460/1000)',
            'error: RPC failed; curl 92 HTTP/2 stream 0 was not closed cleanly',
            'fatal: early EOF',
        ].join('\n');
        expect(summarizeGitFailure(stderr, 128)).to.equal('error: RPC failed; curl 92 HTTP/2 stream 0 was not closed cleanly fatal: early EOF');
    });

    it('falls back to the exit status', () => {
        expect(summarizeGitFailure('Receiving objects: 10% (1/10)\r', 1)).to.equal('git exited with status 1');
    });

    it('redacts credentials in the summary', () => {
        expect(summarizeGitFailure('fatal: https://user:secret@github.com/o/r failed', 128)).to.not.contain('secret');
    });
});

describe('describeRepositoryImportFailure', () => {

    it('explains a missing or private repository', () => {
        expect(describeRepositoryImportFailure('remote: Repository not found.\nfatal: repository not found'))
            .to.contain('not found, or you do not have access');
    });

    it('explains network, disk and permission failures', () => {
        expect(describeRepositoryImportFailure('fatal: unable to access: Could not resolve host: github.com')).to.contain('Could not download');
        expect(describeRepositoryImportFailure('fatal: write error: No space left on device')).to.contain('out of disk space');
        expect(describeRepositoryImportFailure('error: EACCES: permission denied, mkdir')).to.contain('not writable');
    });

    it('reports timeouts and cancellations', () => {
        expect(describeRepositoryImportFailure('Git operation timed out after 900 seconds')).to.contain('took too long');
        expect(describeRepositoryImportFailure('Git operation cancelled')).to.equal('Import cancelled.');
    });

    it('keeps unknown failures but never leaks a token', () => {
        expect(describeRepositoryImportFailure('weird ghp_abcdefghijklmnopqrstuvwxyz0123 failure')).to.equal('weird *** failure');
    });
});
