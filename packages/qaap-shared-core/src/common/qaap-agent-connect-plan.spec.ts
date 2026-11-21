// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveAgentLoginCliCommand } from './qaap-agent-auth-login';
import { resolveAgentConnectionFlow } from './qaap-agent-tui-command';
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
        // The Gemini login command follows the host platform; pin macOS so Windows CI builds the same line.
        const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        let command: string;
        try {
            command = resolveAgentLoginCliCommand('antigravity')!;
        } finally {
            Object.defineProperty(process, 'platform', platform);
        }
        const line = `${buildAgentLoginShellCommand(command, {
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

    it('replaces the leading binary and exports server-validated env overrides on POSIX and Windows', () => {
        const posix = buildAgentLoginShellCommand('codex login --device-auth', {
            binaryPath: '/opt/codex-work/bin/codex',
            env: { CODEX_HOME: '/Users/alice/.codex-work' },
            platform: 'darwin',
        });
        expect(posix).to.include("export CODEX_HOME='/Users/alice/.codex-work'; ");
        expect(posix).to.include("'/opt/codex-work/bin/codex' login --device-auth; echo");

        const win = buildAgentLoginShellCommand('codex login --device-auth', {
            binaryPath: 'C:\\tools\\codex.exe',
            env: { CODEX_HOME: 'C:\\Users\\alice\\.codex-work' },
            platform: 'win32',
        });
        expect(win).to.include("$env:CODEX_HOME = 'C:\\Users\\alice\\.codex-work'; ");
        expect(win).to.include("& 'C:\\tools\\codex.exe' login --device-auth; echo");
    });

    it('resolves the base connection flow for harness instance ids such as codex#2', () => {
        const flow = resolveAgentConnectionFlow('codex#2');
        expect(flow.kind).to.equal('cli-login');
        if (flow.kind === 'cli-login') {
            expect(flow.command).to.include('codex');
        }
    });
});
