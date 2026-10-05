// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
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
        expect(claude.command).to.equal('node');
        expect(claude.args[0]).to.equal(path.join(home, '.qaap-agent-browser-mcp-proxy.cjs'));
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
            command: ['node', path.join(home, '.qaap-agent-browser-mcp-proxy.cjs'), '--headless', '--browser', 'chromium', '--executable-path', '/usr/bin/chromium',
                '--isolated', '--output-dir', '/tmp/qaap-agent-browser-output'],
            enabled: true,
        });
        expect(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8')).to.contain('[mcp_servers.qaap_browser]');
        expect(fs.readFileSync(path.join(home, '.hermes/config.yaml'), 'utf8')).to.contain('qaap_browser:');
        const proxy = fs.readFileSync(path.join(home, '.qaap-agent-browser-mcp-proxy.cjs'), 'utf8');
        expect(proxy).to.contain("message.params.name === 'browser_navigate'");
        expect(proxy).to.contain("+ '/browser-preview'");
        expect(proxy).to.contain('QAAP_AGENT_TASK_ID');
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

    it('bridges only the current URL from successful MCP navigation results', async function () {
        this.timeout(5000);
        ensureQaapAgentBrowserMcpConfiguration(home);

        const executableDir = path.join(home, 'bin');
        fs.mkdirSync(executableDir);
        fs.writeFileSync(path.join(executableDir, 'playwright-mcp'), [
            '#!/usr/bin/env node',
            "let input = '';",
            "process.stdin.on('data', chunk => { input += chunk.toString(); let end; while ((end = input.indexOf('\\n')) >= 0) { const line = input.slice(0, end); input = input.slice(end + 1); try { const request = JSON.parse(line); if (request.method !== 'tools/call') continue; const args = request.params.arguments || {}; const blocked = typeof args.url === 'string' && args.url.includes('10.0.2.2'); const url = request.params.name === 'browser_click' ? 'http://localhost:5173/after-click' : 'http://localhost:5173/redirected'; const result = blocked ? { isError: true, content: [{ type: 'text', text: 'Navigation failed' }] } : { content: [{ type: 'text', text: 'Page URL: ' + url }] }; process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n'); } catch {} } });",
        ].join('\n'), { mode: 0o755 });

        const posted: { taskId: string; url: string }[] = [];
        let receivedToken: string | undefined;
        const server = http.createServer((request, response) => {
            let body = '';
            request.setEncoding('utf8');
            request.on('data', chunk => body += chunk);
            request.on('end', () => {
                receivedToken = request.headers['x-qaap-task-token'] as string | undefined;
                posted.push(JSON.parse(body) as { taskId: string; url: string });
                response.writeHead(204).end();
            });
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') {
            server.close();
            throw new Error('The browser preview test server did not listen on TCP.');
        }

        const proxyPath = path.join(home, '.qaap-agent-browser-mcp-proxy.cjs');
        const child = spawn(process.execPath, [proxyPath], {
            env: {
                ...process.env,
                PATH: `${executableDir}${path.delimiter}${process.env.PATH ?? ''}`,
                QAAP_TASK_API_URL: `http://127.0.0.1:${address.port}/qaap/api/agent-tasks`,
                QAAP_TASK_TOKEN: 'browser-preview-test-token',
                QAAP_AGENT_TASK_ID: 'task-bridge-test',
            },
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        let responseCount = 0;
        let stdout = '';
        let timeout: NodeJS.Timeout | undefined;
        const responses = new Promise<void>((resolve, reject) => {
            child.once('error', reject);
            child.stdout.on('data', chunk => {
                stdout += chunk.toString();
                let end: number;
                while ((end = stdout.indexOf('\n')) >= 0) {
                    stdout = stdout.slice(end + 1);
                    responseCount++;
                    if (responseCount === 3) {
                        resolve();
                    }
                }
            });
            timeout = setTimeout(() => reject(new Error('The browser MCP proxy did not forward all tool results.')), 3000);
        });

        try {
            child.stdin.write([
                { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_navigate', arguments: { url: 'http://localhost:5173/start' } } },
                { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser_click', arguments: { element: 'next' } } },
                { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'browser_navigate', arguments: { url: 'http://10.0.2.2:4873/blocked' } } },
            ].map(request => `${JSON.stringify(request)}\n`).join(''));
            await responses;
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(receivedToken).to.equal('browser-preview-test-token');
            expect(posted).to.deep.equal([
                { taskId: 'task-bridge-test', url: 'http://localhost:5173/redirected' },
                { taskId: 'task-bridge-test', url: 'http://localhost:5173/after-click' },
            ]);
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
            child.kill();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
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
        expect(config).to.contain(`    qaap_browser:\n      command: node\n      args:\n        - "${path.join(home, '.qaap-agent-browser-mcp-proxy.cjs')}"`);
        expect(config).to.contain('    personal:\n        command: personal-mcp');
    });
});
