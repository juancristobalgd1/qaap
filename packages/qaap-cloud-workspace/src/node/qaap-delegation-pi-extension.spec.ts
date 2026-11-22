// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * The Pi delegation extension (`resources/qaap-delegation-pi.mjs`): reads the 0600 config file named by
 * `QAAP_DELEGATION_PI_CONFIG`, removes that variable, and registers the per-task MCP server with Pi.
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { QAAP_AGENT_DELEGATION_PI_CONFIG_ENV } from '../common/qaap-agent-delegation-protocol';
import { resolveQaapDelegationPiExtensionPath } from './qaap-agent-delegation-launch';

type PiExtensionModule = {
    PI_CONFIG_ENV: string;
    readPiDelegationConfig(env: NodeJS.ProcessEnv): { serverName: string; config: Record<string, unknown> } | undefined;
    default(pi: { registerMcpServer?: (name: string, config: unknown) => void }): void;
};

async function importExtension(): Promise<PiExtensionModule> {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<PiExtensionModule>;
    return dynamicImport(pathToFileURL(resolveQaapDelegationPiExtensionPath()).href);
}

describe('qaap-delegation-pi extension', () => {
    const SERVER = 'qaaq_0123456789abcdef';
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-pi-ext-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const writeConfig = (content: unknown): string => {
        const file = path.join(dir, 'pi-delegation.json');
        fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content), { mode: 0o600 });
        return file;
    };

    it('keeps its env variable name in step with the protocol', async () => {
        expect((await importExtension()).PI_CONFIG_ENV).to.equal(QAAP_AGENT_DELEGATION_PI_CONFIG_ENV);
    });

    it('reads the config, removes the variable from the environment and returns the server', async () => {
        const mod = await importExtension();
        const config = { command: 'node', args: ['/shim.mjs'], env: { QAAP_DELEGATION_TOKEN: 't' }, exposure: 'direct' };
        const env: NodeJS.ProcessEnv = { [QAAP_AGENT_DELEGATION_PI_CONFIG_ENV]: writeConfig({ serverName: SERVER, config }) };
        expect(mod.readPiDelegationConfig(env)).to.deep.equal({ serverName: SERVER, config });
        expect(env[QAAP_AGENT_DELEGATION_PI_CONFIG_ENV]).to.equal(undefined);
    });

    it('registers nothing for a missing, unreadable, malformed or foreign-named config', async () => {
        const mod = await importExtension();
        const cases: (string | undefined)[] = [
            undefined,
            path.join(dir, 'nope.json'),
            writeConfig('{not json'),
            writeConfig({ serverName: 'qaaq', config: { command: 'node', args: [] } }),
            writeConfig({ serverName: SERVER, config: { args: [] } }),
        ];
        for (const value of cases) {
            const env: NodeJS.ProcessEnv = value ? { [QAAP_AGENT_DELEGATION_PI_CONFIG_ENV]: value } : {};
            expect(mod.readPiDelegationConfig(env), String(value)).to.equal(undefined);
        }
    });

    it('registers the server with Pi from the process environment, and is a no-op without the variable or the API', async () => {
        const mod = await importExtension();
        const calls: unknown[][] = [];
        const pi = { registerMcpServer: (...args: unknown[]): void => { calls.push(args); } };
        mod.default(pi);
        expect(calls, 'flag off / no config: nothing registered').to.have.length(0);

        const config = { command: 'node', args: ['/shim.mjs'], exposure: 'direct' };
        process.env[QAAP_AGENT_DELEGATION_PI_CONFIG_ENV] = writeConfig({ serverName: SERVER, config });
        try {
            mod.default(pi);
            expect(calls).to.deep.equal([[SERVER, config]]);
            expect(process.env[QAAP_AGENT_DELEGATION_PI_CONFIG_ENV]).to.equal(undefined);
            process.env[QAAP_AGENT_DELEGATION_PI_CONFIG_ENV] = writeConfig({ serverName: SERVER, config });
            expect(() => mod.default({})).to.not.throw();
        } finally {
            delete process.env[QAAP_AGENT_DELEGATION_PI_CONFIG_ENV];
        }
    });
});
