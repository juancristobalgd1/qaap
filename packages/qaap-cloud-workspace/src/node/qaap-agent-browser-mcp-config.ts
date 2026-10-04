// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';

const SERVER_NAME = 'qaap_browser';
const COMMAND = 'playwright-mcp';
const ARGS = ['--headless', '--browser', 'chromium', '--executable-path', '/usr/bin/chromium'];

/** Register the tenant image's pinned headless browser MCP with the harnesses Qaap ships. */
export function ensureQaapAgentBrowserMcpConfiguration(home: string): readonly string[] {
    if (!path.isAbsolute(home)) {
        return [];
    }
    const server = { command: COMMAND, args: ARGS };
    const updated: string[] = [];
    const writeJson = (relativePath: string, update: (root: Record<string, unknown>) => void): void => {
        const filePath = path.join(home, relativePath);
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
        fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
        const temporary = `${filePath}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, content, { mode: 0o600 });
        fs.renameSync(temporary, filePath);
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
        const servers = isRecord(mcp.servers) ? mcp.servers : {};
        root.mcp = { ...mcp, servers: { ...servers, [SERVER_NAME]: {
            type: 'local',
            command: [COMMAND, ...ARGS],
            enabled: true,
        } } };
    });
    appendTomlServer(home, updated);
    appendHermesServer(home, updated);
    return updated;
}

function appendTomlServer(home: string, updated: string[]): void {
    const relativePath = '.codex/config.toml';
    const filePath = path.join(home, relativePath);
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
    if (content.includes(header)) {
        return;
    }
    const block = `${header}\ncommand = "${COMMAND}"\nargs = ${JSON.stringify(ARGS)}\n`;
    const next = `${content.trimEnd()}${content.trim() ? '\n\n' : ''}${block}`;
    writePrivateFile(filePath, next);
    updated.push(relativePath);
}

function appendHermesServer(home: string, updated: string[]): void {
    const relativePath = '.hermes/config.yaml';
    const filePath = path.join(home, relativePath);
    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            return;
        }
        content = '';
    }
    if (content.includes(`${SERVER_NAME}:`)) {
        return;
    }
    const entry = `${SERVER_NAME}:\n    command: ${COMMAND}\n    args:\n${ARGS.map(arg => `      - ${JSON.stringify(arg)}`).join('\n')}\n`;
    let next: string;
    if (/^mcp_servers:\s*\{\s*\}\s*$/m.test(content)) {
        next = content.replace(/^mcp_servers:\s*\{\s*\}\s*$/m, `mcp_servers:\n  ${entry.trimEnd().replace(/\n/g, '\n  ')}`);
    } else if (/^mcp_servers:\s*$/m.test(content)) {
        next = content.replace(/^mcp_servers:\s*$/m, `mcp_servers:\n  ${entry.trimEnd().replace(/\n/g, '\n  ')}`);
    } else {
        next = `${content.trimEnd()}${content.trim() ? '\n\n' : ''}mcp_servers:\n  ${entry.trimEnd().replace(/\n/g, '\n  ')}\n`;
    }
    writePrivateFile(filePath, next);
    updated.push(relativePath);
}

function writePrivateFile(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, content, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
