// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readPiDefaultModelFlag } from './qaap-pi-default-model';

describe('qaap-pi-default-model (backend)', () => {
    let agentDir: string;

    beforeEach(() => {
        agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-pi-default-'));
    });

    afterEach(() => {
        fs.rmSync(agentDir, { recursive: true, force: true });
    });

    it('reads the owner agent directory and keeps a settings pin', () => {
        fs.writeFileSync(path.join(agentDir, 'auth.json'), '{"openrouter":{"type":"api_key"}}');
        const env = { PI_CODING_AGENT_DIR: agentDir } as NodeJS.ProcessEnv;
        expect(readPiDefaultModelFlag(env)).to.contain('--model openrouter/');
        fs.writeFileSync(path.join(agentDir, 'settings.json'), '{"defaultProvider":"openrouter","defaultModel":"moonshotai/kimi-k2.6"}');
        expect(readPiDefaultModelFlag(env)).to.equal('');
    });

    it('applies nothing when the directory has no sign-in and no key', () => {
        expect(readPiDefaultModelFlag({ PI_CODING_AGENT_DIR: agentDir } as NodeJS.ProcessEnv)).to.equal('');
    });
});
