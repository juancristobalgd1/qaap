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
        expect(mcp('.gemini/settings.json')).to.have.property('qaap_browser');
        expect(mcp('.gemini/antigravity/mcp_config.json')).to.have.property('qaap_browser');
        expect(mcp('.cursor/mcp.json')).to.have.property('qaap_browser');
        expect(mcp('.copilot/mcp-config.json').qaap_browser).to.have.property('tools').that.deep.equals(['*']);
        expect((read('.config/opencode/opencode.json').mcp as { servers: Record<string, unknown> }).servers)
            .to.have.property('qaap_browser');
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
});
