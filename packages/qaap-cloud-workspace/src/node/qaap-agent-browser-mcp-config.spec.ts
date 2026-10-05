// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect } from 'chai';
import { ensureQaapAgentBrowserMcpConfiguration } from './qaap-agent-browser-mcp-config';

describe('Qaap agent browser MCP configuration', () => {
    let home: string;

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-browser-mcp-'));
    });

    afterEach(() => {
        fs.rmSync(home, { recursive: true, force: true });
    });

    it('registers the headless tenant Chromium server for every supported harness', () => {
        const updated = ensureQaapAgentBrowserMcpConfiguration(home);
        const read = (file: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(home, file), 'utf8'));
        const mcp = (file: string, key = 'mcpServers'): Record<string, unknown> => read(file)[key] as Record<string, unknown>;
        const claude = mcp('.claude.json').qaap_browser as { command: string; args: string[] };
        expect(claude.command).to.equal('playwright-mcp');
        expect(claude.args).to.include('--headless');
        expect(claude.args).to.include('/usr/bin/chromium');
        expect(claude.args).to.include('--isolated');
        expect(claude.args).to.include('--output-dir');
        expect(claude.args).to.include('/tmp/qaap-agent-browser-output');
        expect(mcp('.gemini/settings.json')).to.have.property('qaap_browser');
        expect(mcp('.gemini/antigravity/mcp_config.json')).to.have.property('qaap_browser');
        expect(mcp('.cursor/mcp.json')).to.have.property('qaap_browser');
        expect(mcp('.copilot/mcp-config.json').qaap_browser).to.have.property('tools').that.deep.equals(['*']);
        const opencode = read('.config/opencode/opencode.json').mcp as Record<string, unknown>;
        expect(opencode.qaap_browser).to.deep.equal({
            type: 'local',
            command: ['playwright-mcp', '--headless', '--browser', 'chromium', '--executable-path', '/usr/bin/chromium',
                '--isolated', '--output-dir', '/tmp/qaap-agent-browser-output'],
            enabled: true,
        });
        expect(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8')).to.contain('[mcp_servers.qaap_browser]');
        expect(fs.readFileSync(path.join(home, '.hermes/config.yaml'), 'utf8')).to.contain('qaap_browser:');
        expect(updated).to.have.length(8);
    });

    it('preserves user MCP servers and is idempotent', () => {
        fs.mkdirSync(home, { recursive: true });
        fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { personal: { command: 'my-mcp' } } }));
        ensureQaapAgentBrowserMcpConfiguration(home);
        const first = fs.readFileSync(path.join(home, '.claude.json'), 'utf8');
        expect(JSON.parse(first).mcpServers).to.have.property('personal');
        expect(ensureQaapAgentBrowserMcpConfiguration(home)).to.have.length(0);
        expect(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).to.equal(first);
    });

    it('updates persistent config through its symlink and does not follow a planted temp symlink', () => {
        const persistentHome = path.join(home, 'persistent-home');
        fs.mkdirSync(persistentHome, { recursive: true });
        const persistentConfig = path.join(persistentHome, '.claude.json');
        fs.writeFileSync(persistentConfig, JSON.stringify({ mcpServers: { personal: { command: 'personal-mcp' } } }));
        const configLink = path.join(home, '.claude.json');
        fs.symlinkSync(persistentConfig, configLink);
        const victim = path.join(home, 'victim.txt');
        fs.writeFileSync(victim, 'leave this alone');
        fs.symlinkSync(victim, `${configLink}.${process.pid}.tmp`);

        ensureQaapAgentBrowserMcpConfiguration(home);

        expect(fs.lstatSync(configLink).isSymbolicLink()).to.equal(true);
        expect(JSON.parse(fs.readFileSync(persistentConfig, 'utf8')).mcpServers).to.have.property('qaap_browser');
        expect(JSON.parse(fs.readFileSync(persistentConfig, 'utf8')).mcpServers).to.have.property('personal');
        expect(fs.readFileSync(victim, 'utf8')).to.equal('leave this alone');
    });

    it('does not follow a planted temporary symlink when replacing a regular config', () => {
        const configPath = path.join(home, '.claude.json');
        fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { personal: { command: 'personal-mcp' } } }));
        const victim = path.join(home, 'victim.txt');
        fs.writeFileSync(victim, 'leave this alone');
        fs.symlinkSync(victim, `${configPath}.${process.pid}.tmp`);

        ensureQaapAgentBrowserMcpConfiguration(home);

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { mcpServers: Record<string, unknown> };
        expect(config.mcpServers).to.have.property('qaap_browser');
        expect(config.mcpServers).to.have.property('personal');
        expect(fs.readFileSync(victim, 'utf8')).to.equal('leave this alone');
    });

    it('migrates the old invalid OpenCode mcp.servers shape', () => {
        const configPath = path.join(home, '.config/opencode/opencode.json');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({ mcp: { servers: { qaap_browser: { command: 'old' } } } }));

        ensureQaapAgentBrowserMcpConfiguration(home);

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { mcp: Record<string, unknown> };
        expect(config.mcp).not.to.have.property('servers');
        expect(config.mcp.qaap_browser).to.have.property('type', 'local');
    });

    it('adds Hermes MCP at the existing YAML mapping indentation', () => {
        const configPath = path.join(home, '.hermes/config.yaml');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, 'mcp_servers:\n    personal:\n        command: personal-mcp\n');

        ensureQaapAgentBrowserMcpConfiguration(home);

        const config = fs.readFileSync(configPath, 'utf8');
        expect(config).to.match(/^    qaap_browser:\n      command: playwright-mcp\n      args:\n/m);
        expect(config).to.contain('    personal:\n        command: personal-mcp');
    });
});
