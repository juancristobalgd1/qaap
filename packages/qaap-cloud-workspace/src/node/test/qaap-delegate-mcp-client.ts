// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Spawns the delegation MCP shim (`resources/qaap-delegate-mcp.mjs`) and talks JSON-RPC to it over stdio. */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface } from 'readline';
import { resolveQaapDelegateMcpPath } from '../qaap-agent-delegation-launch';

/** One JSON-RPC message as the shim writes it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type QaapShimMessage = Record<string, any>;

export interface QaapShimClient {
    readonly child: ChildProcessWithoutNullStreams;
    readonly messages: QaapShimMessage[];
    stderr(): string;
    send(message: unknown): void;
    request(method: string, params?: unknown): Promise<QaapShimMessage>;
    waitFor(match: (message: QaapShimMessage) => boolean, timeoutMs?: number): Promise<QaapShimMessage>;
    close(): Promise<void>;
}

/** Starts the shim with only PATH plus `env`, so nothing from the test process leaks into it. */
export function startQaapDelegateShim(env: Record<string, string>): QaapShimClient {
    const child = spawn(process.execPath, [resolveQaapDelegateMcpPath()], {
        env: { PATH: process.env.PATH ?? '', ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const messages: QaapShimMessage[] = [];
    const waiters: { match: (message: QaapShimMessage) => boolean; resolve: (message: QaapShimMessage) => void }[] = [];
    const stderr: string[] = [];
    createInterface({ input: child.stdout }).on('line', line => {
        const message = JSON.parse(line) as QaapShimMessage; // every stdout line must be JSON-RPC
        messages.push(message);
        for (const waiter of [...waiters]) {
            if (waiter.match(message)) {
                waiters.splice(waiters.indexOf(waiter), 1);
                waiter.resolve(message);
            }
        }
    });
    child.stderr.on('data', chunk => stderr.push(chunk.toString()));
    let nextId = 1;
    const client: QaapShimClient = {
        child,
        messages,
        stderr: () => stderr.join(''),
        send: message => {
            child.stdin.write(`${JSON.stringify(message)}\n`);
        },
        request: (method, params) => {
            const id = nextId++;
            client.send({ jsonrpc: '2.0', id, method, params });
            return client.waitFor(message => message.id === id);
        },
        waitFor: (match, timeoutMs = 5000) => {
            const found = messages.find(match);
            if (found) {
                return Promise.resolve(found);
            }
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`timed out waiting for a shim message; stderr: ${stderr.join('')}`)), timeoutMs);
                waiters.push({ match, resolve: message => { clearTimeout(timer); resolve(message); } });
            });
        },
        close: () => {
            // eslint-disable-next-line no-null/no-null -- child_process exit/signal codes are null by Node contract
            if (child.exitCode !== null || child.signalCode !== null) {
                return Promise.resolve();
            }
            const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
            child.stdin.end();
            return exited;
        },
    };
    return client;
}

/** Imports the ESM shim for its exported constants (a real `import()`: TypeScript would turn it into `require`). */
export async function importQaapDelegateShim(): Promise<Record<string, unknown>> {
    const { pathToFileURL } = await import('url');
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;
    return dynamicImport(pathToFileURL(resolveQaapDelegateMcpPath()).href);
}
