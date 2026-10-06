// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveAgentLoginCliCommand } from '../common/qaap-agent-auth-login';
import { buildAgentLoginShellCommand, parseAgentLoginExitMarker } from '../common/qaap-agent-connect-plan';

/**
 * Stand-in for Gemini CLI (the Antigravity harness) that behaves like the versions that hold the
 * sign-in link behind the folder-trust dialog: it only trusts the folder through
 * `~/.gemini/trustedFolders.json` (it ignores GEMINI_CLI_TRUST_WORKSPACE), and only prints the
 * NO_BROWSER link when "Login with Google" is preselected.
 */
const FAKE_GEMINI = `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), os = require('os');
const dir = path.join(os.homedir(), '.gemini');
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const rule = read(path.join(dir, 'trustedFolders.json'))[fs.realpathSync(process.cwd())];
if (rule !== 'TRUST_FOLDER') {
    console.log('Do you trust this folder?');
    console.log('Trusting a folder allows Gemini CLI to load its local configurations, including custom commands, hooks, MCP servers, agent skills, and settings.');
    process.exit(3);
}
const settings = read(path.join(dir, 'settings.json'));
if (settings.security?.auth?.selectedType !== 'oauth-personal' || !process.env.NO_BROWSER) {
    console.log('How would you like to authenticate for this project?');
    process.exit(4);
}
console.log('Please visit the following URL to authorize the application:');
console.log('https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fcodeassist.google.com%2Fauthcode&response_type=code');
console.log('Enter the authorization code:');
`;

(process.platform === 'win32' ? describe.skip : describe)('Antigravity (Gemini CLI) Connect command', () => {

    let root: string;
    let home: string;
    let workspace: string;
    let bin: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-gemini-login-'));
        home = path.join(root, 'home', 'agent');
        workspace = path.join(root, 'workspace', 'tenant', 'repo');
        bin = path.join(root, 'bin');
        for (const directory of [home, workspace, bin]) {
            fs.mkdirSync(directory, { recursive: true });
        }
        fs.writeFileSync(path.join(bin, 'gemini'), FAKE_GEMINI, { mode: 0o755 });
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    /** Runs the exact wrapped command the hidden Connect terminal sends, as the agent (its HOME). */
    const runConnect = (): string => {
        const command = resolveAgentLoginCliCommand('antigravity');
        expect(command).to.be.a('string');
        return execFileSync('sh', ['-c', buildAgentLoginShellCommand(command!, { cliBinDirectory: bin })], {
            cwd: workspace,
            env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: home },
            timeout: 15_000,
        }).toString();
    };
    const geminiFile = (name: string): string => path.join(home, '.gemini', name);
    const readGeminiJson = (name: string): Record<string, unknown> => JSON.parse(fs.readFileSync(geminiFile(name), 'utf8'));

    it('prints the Google sign-in link instead of stopping at the folder-trust dialog', () => {
        const output = runConnect();

        expect(output).to.not.contain('Do you trust this folder?');
        expect(output).to.contain('https://accounts.google.com/o/oauth2/v2/auth');
        expect(output).to.contain('Enter the authorization code:');
        expect(parseAgentLoginExitMarker(output)).to.equal(0);
    });

    it('trusts only the tenant workspace, in the agent home, without turning folder trust off', () => {
        runConnect();

        expect(readGeminiJson('trustedFolders.json')).to.deep.equal({ [fs.realpathSync(workspace)]: 'TRUST_FOLDER' });
        expect(fs.statSync(geminiFile('trustedFolders.json')).mode & 0o777).to.equal(0o600);
        const settings = readGeminiJson('settings.json') as { security?: { folderTrust?: unknown; auth?: { selectedType?: string } }; ide?: { hasSeenNudge?: boolean } };
        expect(settings.security?.auth?.selectedType).to.equal('oauth-personal');
        expect(settings.security?.folderTrust, 'folder trust stays on for every other folder').to.equal(undefined);
        expect(settings.ide?.hasSeenNudge).to.equal(true);
    });

    it('keeps the agent\'s other settings and trust rules', () => {
        fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
        fs.writeFileSync(geminiFile('settings.json'), JSON.stringify({ ui: { theme: 'GitHub' }, security: { folderTrust: { enabled: true } } }));
        fs.writeFileSync(geminiFile('trustedFolders.json'), JSON.stringify({ '/elsewhere': 'DO_NOT_TRUST' }));

        expect(runConnect()).to.contain('https://accounts.google.com/o/oauth2/v2/auth');

        expect(readGeminiJson('settings.json')).to.deep.equal({
            ui: { theme: 'GitHub' },
            security: { folderTrust: { enabled: true }, auth: { selectedType: 'oauth-personal' } },
            ide: { hasSeenNudge: true },
        });
        expect(readGeminiJson('trustedFolders.json')).to.deep.equal({
            '/elsewhere': 'DO_NOT_TRUST',
            [fs.realpathSync(workspace)]: 'TRUST_FOLDER',
        });
    });

    it('never overwrites the user\'s own decision for the folder or a file it cannot parse', () => {
        fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
        fs.writeFileSync(geminiFile('trustedFolders.json'), JSON.stringify({ [fs.realpathSync(workspace)]: 'DO_NOT_TRUST' }));
        runConnect();
        expect(readGeminiJson('trustedFolders.json')).to.deep.equal({ [fs.realpathSync(workspace)]: 'DO_NOT_TRUST' });

        const commented = '// kept by hand\n{ "/elsewhere": "TRUST_FOLDER" }\n';
        fs.writeFileSync(geminiFile('trustedFolders.json'), commented);
        runConnect();
        expect(fs.readFileSync(geminiFile('trustedFolders.json'), 'utf8')).to.equal(commented);
    });
});
