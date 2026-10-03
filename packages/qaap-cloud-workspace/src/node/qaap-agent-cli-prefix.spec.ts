// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    canExposeAgentCliBinToChild,
    prependAgentCliBinToPath,
    resolveAgentCliBinDirectory,
    resolveAgentCliPrefix,
    resolveAgentCliPrefixForEnv,
} from './qaap-agent-cli-prefix';

describe('per-user agent CLI prefix', () => {
    it('uses a private .qaap/cli prefix and puts its binaries before image PATH entries', () => {
        const home = '/home/qaap-tenants/alice';
        const prefix = resolveAgentCliPrefix(home);
        const bin = resolveAgentCliBinDirectory(home, 'linux');
        const env: NodeJS.ProcessEnv = { PATH: ['/usr/local/bin', '/usr/bin'].join(path.delimiter) };

        prependAgentCliBinToPath(env, prefix, 'linux');
        prependAgentCliBinToPath(env, prefix, 'linux');

        expect(prefix).to.equal(path.join(home, '.qaap', 'cli'));
        expect(env.PATH?.split(path.delimiter)).to.deep.equal([bin, '/usr/local/bin', '/usr/bin']);
    });

    it('removes another tenant prefix before selecting this tenant home', () => {
        const env: NodeJS.ProcessEnv = {
            PATH: ['/home/bob/.qaap/cli/bin', '/usr/local/bin'].join(path.delimiter),
        };

        prependAgentCliBinToPath(env, resolveAgentCliPrefix('/home/alice'), 'linux');

        expect(env.PATH?.split(path.delimiter)).to.deep.equal([
            resolveAgentCliBinDirectory('/home/alice', 'linux'),
            '/usr/local/bin',
        ]);
    });

    it('keeps tenant-backend installs on the persistent agent storage mount, not the read-only/tmpfs home', () => {
        const env: NodeJS.ProcessEnv = { QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_CONFIG_ROOT: '/home/theia/.qaap' };
        const prefix = resolveAgentCliPrefixForEnv(env, '/home/qaap-agent');
        expect(prefix).to.equal('/home/theia/.qaap/.qaap-agent-storage/data/qaap-cli');

        const pathEnv: NodeJS.ProcessEnv = { PATH: ['/home/qaap-agent/.qaap/cli/bin', '/usr/local/bin'].join(path.delimiter) };
        prependAgentCliBinToPath(pathEnv, prefix, 'linux');
        expect(pathEnv.PATH?.split(path.delimiter)).to.deep.equal([path.join(prefix, 'bin'), '/usr/local/bin']);

        expect(resolveAgentCliPrefixForEnv({ ...env, QAAP_TENANT_AGENT_STORAGE_ROOT: 'off' }, '/home/qaap-agent'))
            .to.equal(path.join('/home/qaap-agent', '.qaap', 'cli'));
        expect(resolveAgentCliPrefixForEnv({}, '/home/qaap-agent')).to.equal(path.join('/home/qaap-agent', '.qaap', 'cli'));
    });

    it('uses the npm prefix itself as the executable directory on Windows', () => {
        expect(resolveAgentCliBinDirectory('C:\\Users\\alice', 'win32'))
            .to.equal(path.join('C:\\Users\\alice', '.qaap', 'cli'));
    });

    it('exposes a tenant-writable prefix to root-launched children only when they run as the tenant', () => {
        const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-cli-expose-'));
        try {
            const prefix = path.join(sandbox, '.qaap', 'cli');
            fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true });
            // A non-root backend never gains privileges from the prefix.
            expect(canExposeAgentCliBinToChild(prefix, () => false, 1000)).to.equal(true);
            // A root backend with a uid drop: the child resolves the prefix as the tenant.
            expect(canExposeAgentCliBinToChild(prefix, () => true, 0)).to.equal(true);
            if (process.platform !== 'win32' && process.getuid?.() !== 0) {
                // Root without a drop would itself resolve binaries from a directory it does not own.
                expect(canExposeAgentCliBinToChild(prefix, () => false, 0)).to.equal(false);
                expect(canExposeAgentCliBinToChild(prefix, () => {
                    throw new Error('misconfigured identity');
                }, 0)).to.equal(false);
            }
        } finally {
            fs.rmSync(sandbox, { recursive: true, force: true });
        }
    });
});
