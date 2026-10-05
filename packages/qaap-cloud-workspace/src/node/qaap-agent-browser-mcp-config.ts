// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import { randomUUID } from 'crypto';
import * as path from 'path';

const SERVER_NAME = 'qaap_browser';
const COMMAND = 'playwright-mcp';
const ARGS = ['--headless', '--browser', 'chromium', '--executable-path', '/usr/bin/chromium'];

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
        `const { randomUUID } = require('crypto');`,
        `const path = require('path');`,
        `const SERVER_NAME = ${JSON.stringify(SERVER_NAME)};`,
        `const COMMAND = ${JSON.stringify(COMMAND)};`,
        `const ARGS = ${JSON.stringify(ARGS)};`,
        helpers,
        `ensureQaapAgentBrowserMcpConfiguration(process.env.HOME);`,
    ].join('\n');
}

/** Register the tenant image's pinned headless browser MCP with the harnesses Qaap ships. */
export function ensureQaapAgentBrowserMcpConfiguration(home: string): readonly string[] {
    if (!path.isAbsolute(home)) {
        return [];
    }
    const server = { command: COMMAND, args: ARGS };
    const updated: string[] = [];
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
            command: [COMMAND, ...ARGS],
            enabled: true,
        } };
    });
    appendTomlServer(home, updated);
    appendHermesServer(home, updated);
    return updated;
}

function appendTomlServer(home: string, updated: string[]): void {
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
    const existingEntry = /^([ \t]+)qaap_browser:\s*$/m.exec(content);
    if (existingEntry) {
        return;
    }
    const formatEntry = (indent: string): string => `${indent}${SERVER_NAME}:\n`
        + `${indent}  command: ${COMMAND}\n`
        + `${indent}  args:\n`
        + `${ARGS.map(arg => `${indent}    - ${JSON.stringify(arg)}`).join('\n')}\n`;
    let next: string;
    const emptySection = /^mcp_servers:\s*\{\s*\}\s*$/m;
    const heading = /^mcp_servers:\s*$/m;
    const headingMatch = heading.exec(content);
    if (emptySection.test(content)) {
        next = content.replace(emptySection, `mcp_servers:\n${formatEntry('  ').trimEnd()}`);
    } else if (headingMatch) {
        const following = content.slice(headingMatch.index + headingMatch[0].length);
        const childIndent = /^[ \t]+(?=\S)/m.exec(following)?.[0] ?? '  ';
        next = content.replace(heading, `${headingMatch[0]}\n${formatEntry(childIndent).trimEnd()}`);
    } else {
        next = `${content.trimEnd()}${content.trim() ? '\n\n' : ''}mcp_servers:\n${formatEntry('  ')}`;
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
