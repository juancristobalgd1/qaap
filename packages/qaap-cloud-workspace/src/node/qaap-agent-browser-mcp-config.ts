// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import { randomUUID } from 'crypto';
import * as path from 'path';

const SERVER_NAME = 'qaap_browser';
const PLAYWRIGHT_COMMAND = 'playwright-mcp';
const PLAYWRIGHT_ARGS = [
    '--headless',
    '--browser', 'chromium',
    '--executable-path', '/usr/bin/chromium',
    '--isolated',
    '--output-dir', '/tmp/qaap-agent-browser-output',
];
const PROXY_FILE = '.qaap-agent-browser-mcp-proxy.cjs';
const PROXY_SCRIPT = [
    "'use strict';",
    "const { spawn } = require('node:child_process');",
    "const http = require('node:http');",
    "const https = require('node:https');",
    "const { URL } = require('node:url');",
    "function publishUrl(rawUrl) {",
    "  if (!process.env.QAAP_TASK_API_URL || !process.env.QAAP_TASK_TOKEN || !process.env.QAAP_AGENT_TASK_ID || !rawUrl) return;",
    "  let pageUrl; let endpoint;",
    "  try { pageUrl = new URL(rawUrl); endpoint = new URL(process.env.QAAP_TASK_API_URL.replace(/\\/$/, '') + '/browser-preview'); } catch { return; }",
    "  if ((pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') || pageUrl.username || pageUrl.password || (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:')) return;",
    "  const body = JSON.stringify({ taskId: process.env.QAAP_AGENT_TASK_ID, url: pageUrl.toString() });",
    "  const transport = endpoint.protocol === 'https:' ? https : http;",
    "  const request = transport.request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-qaap-task-token': process.env.QAAP_TASK_TOKEN, 'content-length': Buffer.byteLength(body) } }, response => response.resume());",
    "  request.on('error', () => undefined); request.end(body);",
    "}",
    "const child = spawn('playwright-mcp', process.argv.slice(2), { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });",
    "let input = '';",
    "process.stdin.on('data', chunk => { input += chunk.toString(); let end; while ((end = input.indexOf('\\n')) >= 0) { const line = input.slice(0, end); input = input.slice(end + 1); try { const message = JSON.parse(line); if (message.method === 'tools/call' && message.params && message.params.name === 'browser_navigate') publishUrl(message.params.arguments && message.params.arguments.url); } catch {} child.stdin.write(line + '\\n'); } });",
    "let output = '';",
    "child.stdout.on('data', chunk => { process.stdout.write(chunk); output += chunk.toString(); let end; while ((end = output.indexOf('\\n')) >= 0) { const line = output.slice(0, end); output = output.slice(end + 1); try { const message = JSON.parse(line); const text = (message.result && message.result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\\n'); const match = /Page URL:\\s*(https?:\\/\\/[^\\s]+)/.exec(text); if (match) publishUrl(match[1]); } catch {} } });",
    "child.on('exit', code => process.exit(code === null ? 1 : code));",
    "process.on('SIGINT', () => child.kill('SIGINT')); process.on('SIGTERM', () => child.kill('SIGTERM'));",
].join('\n');

/**
 * Build a self-contained bootstrap for isolated Docker workers, which cannot load the backend's
 * compiled package path. The code runs inside the tenant process and uses only Node built-ins.
 */
export function createQaapAgentBrowserMcpBootstrapScript(): string {
    const helpers = [
        ensureQaapAgentBrowserMcpConfiguration,
        appendTomlServer,
        appendHermesServer,
        writePrivateFile,
        resolveConfigFilePath,
        isRecord,
    ].map(helper => helper.toString()).join('\n\n');
    return [
        `const fs = require('fs');`,
        // The compiled helper below refers to the CommonJS import binding emitted by tsc.
        `const crypto_1 = require('crypto');`,
        `const path = require('path');`,
        `const SERVER_NAME = ${JSON.stringify(SERVER_NAME)};`,
        `const PLAYWRIGHT_COMMAND = ${JSON.stringify(PLAYWRIGHT_COMMAND)};`,
        `const PLAYWRIGHT_ARGS = ${JSON.stringify(PLAYWRIGHT_ARGS)};`,
        `const PROXY_FILE = ${JSON.stringify(PROXY_FILE)};`,
        `const PROXY_SCRIPT = ${JSON.stringify(PROXY_SCRIPT)};`,
        helpers,
        `ensureQaapAgentBrowserMcpConfiguration(process.env.HOME);`,
    ].join('\n');
}

/** Register the tenant image's pinned headless browser MCP with the harnesses Qaap ships. */
export function ensureQaapAgentBrowserMcpConfiguration(home: string): readonly string[] {
    if (!path.isAbsolute(home)) {
        return [];
    }
    const proxyPath = path.join(home, PROXY_FILE);
    const server = { command: 'node', args: [proxyPath, ...PLAYWRIGHT_ARGS] };
    const updated: string[] = [];
    try {
        if (fs.readFileSync(proxyPath, 'utf8') !== PROXY_SCRIPT) {
            writePrivateFile(proxyPath, PROXY_SCRIPT);
        }
    } catch {
        writePrivateFile(proxyPath, PROXY_SCRIPT);
    }
    const writeJson = (relativePath: string, update: (root: Record<string, unknown>) => void): void => {
        const filePath = resolveConfigFilePath(home, relativePath);
        let root: Record<string, unknown> = {};
        try {
            const existing = fs.readFileSync(filePath, 'utf8');
            const parsed: unknown = JSON.parse(existing);
            if (!isRecord(parsed)) {
                return;
            }
            root = parsed;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                return;
            }
        }
        update(root);
        const content = `${JSON.stringify(root, undefined, 2)}\n`;
        try {
            if (fs.readFileSync(filePath, 'utf8') === content) {
                return;
            }
        } catch {
            // The file will be created below.
        }
        writePrivateFile(filePath, content);
        updated.push(relativePath);
    };
    const addMcpServer = (root: Record<string, unknown>, key: string, serverConfig: unknown): void => {
        const current = isRecord(root[key]) ? root[key] as Record<string, unknown> : {};
        root[key] = { ...current, [SERVER_NAME]: serverConfig };
    };

    // Claude Code, OpenClaude and QAIQ share the Claude user MCP registry.
    writeJson('.claude.json', root => addMcpServer(root, 'mcpServers', server));
    // Gemini CLI and Antigravity use the same MCP server object shape.
    writeJson('.gemini/settings.json', root => addMcpServer(root, 'mcpServers', server));
    writeJson('.gemini/antigravity/mcp_config.json', root => addMcpServer(root, 'mcpServers', server));
    writeJson('.copilot/mcp-config.json', root => addMcpServer(root, 'mcpServers', {
        ...server,
        type: 'local',
        tools: ['*'],
    }));
    writeJson('.cursor/mcp.json', root => addMcpServer(root, 'mcpServers', server));
    writeJson('.config/opencode/opencode.json', root => {
        const mcp = isRecord(root.mcp) ? root.mcp : {};
        const current = { ...mcp };
        const legacyServers = isRecord(current.servers) ? current.servers : undefined;
        if (legacyServers && Object.keys(legacyServers).every(name => name === SERVER_NAME)) {
            delete current.servers;
        }
        root.mcp = { ...current, [SERVER_NAME]: {
            type: 'local',
            command: [server.command, ...server.args],
            enabled: true,
        } };
    });
    appendTomlServer(home, updated, server.command, server.args);
    appendHermesServer(home, updated, server.command, server.args);
    return updated;
}

function appendTomlServer(home: string, updated: string[], command: string, args: readonly string[]): void {
    const relativePath = '.codex/config.toml';
    const filePath = resolveConfigFilePath(home, relativePath);
    const header = `[mcp_servers.${SERVER_NAME}]`;
    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            return;
        }
        content = '';
    }
    const block = `${header}\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n`;
    const existing = /(^|\n)\[mcp_servers\.qaap_browser\][\s\S]*?(?=\n\[|$)/.exec(content);
    const next = existing
        ? content.replace(existing[0], `${existing[1]}${block.trimEnd()}${existing[0].endsWith('\n') ? '\n' : ''}`)
        : `${content.trimEnd()}${content.trim() ? '\n\n' : ''}${block}`;
    if (next === content) {
        return;
    }
    writePrivateFile(filePath, next);
    updated.push(relativePath);
}

function appendHermesServer(home: string, updated: string[], command: string, args: readonly string[]): void {
    const relativePath = '.hermes/config.yaml';
    const filePath = resolveConfigFilePath(home, relativePath);
    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            return;
        }
        content = '';
    }
    const formatEntry = (indent: string): string => `${indent}${SERVER_NAME}:\n`
        + `${indent}  command: ${command}\n`
        + `${indent}  args:\n`
        + `${args.map(arg => `${indent}    - ${JSON.stringify(arg)}`).join('\n')}\n`;
    let next: string;
    const emptySection = /^mcp_servers:\s*\{\s*\}\s*$/m;
    const heading = /^mcp_servers:\s*$/m;
    const headingMatch = heading.exec(content);
    const existingEntry = /^([ \t]+)qaap_browser:\s*$/m.exec(content);
    if (existingEntry) {
        const lines = content.split('\n');
        const index = lines.findIndex(line => /^[ \t]+qaap_browser:\s*$/.test(line));
        const indent = existingEntry[1];
        let end = index + 1;
        while (end < lines.length) {
            const line = lines[end];
            const nextIndent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
            if (line.trim() && nextIndent <= indent.length) {
                break;
            }
            end++;
        }
        const keepFinalNewline = end === lines.length && content.endsWith('\n');
        lines.splice(index, end - index, `${formatEntry(indent).trimEnd()}${keepFinalNewline ? '\n' : ''}`);
        next = lines.join('\n');
    } else if (emptySection.test(content)) {
        next = content.replace(emptySection, `mcp_servers:\n${formatEntry('  ').trimEnd()}`);
    } else if (headingMatch) {
        const following = content.slice(headingMatch.index + headingMatch[0].length);
        const childIndent = /^[ \t]+(?=\S)/m.exec(following)?.[0] ?? '  ';
        next = content.replace(heading, `${headingMatch[0]}\n${formatEntry(childIndent).trimEnd()}`);
    } else {
        next = `${content.trimEnd()}${content.trim() ? '\n\n' : ''}mcp_servers:\n${formatEntry('  ')}`;
    }
    if (next === content) {
        return;
    }
    writePrivateFile(filePath, next);
    updated.push(relativePath);
}

function writePrivateFile(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try {
        fs.writeFileSync(descriptor, content, 'utf8');
    } finally {
        fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, filePath);
}

/** Write through the persistent-home symlink rather than replacing the link in tmpfs HOME. */
function resolveConfigFilePath(home: string, relativePath: string): string {
    const filePath = path.join(home, relativePath);
    try {
        if (fs.lstatSync(filePath).isSymbolicLink()) {
            return fs.realpathSync(filePath);
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
    return filePath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
