// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveAgentLoginCliCommand } from './qaap-agent-auth-login';
import {
    buildAgentLoginShellCommand,
    QAAP_AGENT_LOGIN_INPUT_CHUNK_BYTES,
    splitAgentLoginShellInput,
} from './qaap-agent-connect-plan';

describe('splitAgentLoginShellInput', () => {

    it('keeps a short command as one write', () => {
        expect(splitAgentLoginShellInput('claude auth login\r')).to.deep.equal(['claude auth login\r']);
    });

    it('splits the Gemini Connect command into pieces macOS does not drop', () => {
        const line = `${buildAgentLoginShellCommand(resolveAgentLoginCliCommand('antigravity')!, {
            cliBinDirectory: '/Users/someone/.qaap/cli/bin',
            platform: 'darwin',
        })}\r`;
        expect(new TextEncoder().encode(line).length).to.be.greaterThan(1024);
        const chunks = splitAgentLoginShellInput(line);
        expect(chunks.join('')).to.equal(line);
        expect(chunks.length).to.be.greaterThan(1);
        for (const chunk of chunks) {
            expect(new TextEncoder().encode(chunk).length).to.be.at.most(QAAP_AGENT_LOGIN_INPUT_CHUNK_BYTES);
        }
        expect(chunks[chunks.length - 1].endsWith('\r')).to.equal(true);
    });

    it('counts UTF-8 bytes and never splits a surrogate pair', () => {
        const chunks = splitAgentLoginShellInput('ab😀cd', 5);
        expect(chunks).to.deep.equal(['ab', '😀c', 'd']);
        expect(chunks.join('')).to.equal('ab😀cd');
    });

    it('returns no writes for an empty command', () => {
        expect(splitAgentLoginShellInput('')).to.deep.equal([]);
    });
});
