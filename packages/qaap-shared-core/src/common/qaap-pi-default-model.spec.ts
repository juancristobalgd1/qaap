// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OPENROUTER_DEFAULT_FREE_MODELS } from '@theia/qaap-ai-openrouter/lib/common/openrouter-models';
import { buildPiDefaultModelFlagShell, PI_DEFAULT_OPENROUTER_MODEL_ID } from './qaap-pi-default-model';

const DEFAULT_FLAG = `--model openrouter/${OPENROUTER_DEFAULT_FREE_MODELS[0]}`;

/** Runs the substitution the way the Pi child's command does: sh, with the child's HOME and env. */
function flagFor(home: string, env: Record<string, string> = {}): string {
    // Unquoted, as `{model_flags}` sits in the agent template: the words split exactly as Pi's argv would.
    const command = `printf '%s ' ${buildPiDefaultModelFlagShell()}`;
    return execFileSync('sh', ['-c', command], {
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, ...env },
        encoding: 'utf8',
    }).trim();
}

describe('qaap-pi-default-model', () => {
    let home: string;

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-pi-home-'));
    });

    afterEach(() => {
        fs.rmSync(home, { recursive: true, force: true });
    });

    const agentDir = (): string => {
        const dir = path.join(home, '.pi', 'agent');
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    };

    it('reuses the head of the OpenRouter free default list', () => {
        expect(PI_DEFAULT_OPENROUTER_MODEL_ID).to.equal(OPENROUTER_DEFAULT_FREE_MODELS[0]);
    });

    it('passes the OpenRouter default when the child has an OpenRouter sign-in or key and no pin', () => {
        fs.writeFileSync(path.join(agentDir(), 'auth.json'), '{"openrouter":{"type":"api_key"}}');
        expect(flagFor(home)).to.equal(DEFAULT_FLAG);
        expect(flagFor(home, { OPENROUTER_API_KEY: 'k' })).to.equal(DEFAULT_FLAG);
    });

    it('keeps the owner pin in settings.json: defaultModel or defaultProvider', () => {
        fs.writeFileSync(path.join(agentDir(), 'auth.json'), '{"openrouter":{}}');
        fs.writeFileSync(path.join(agentDir(), 'settings.json'), '{"defaultModel":"moonshotai/kimi-k2.6"}');
        expect(flagFor(home)).to.equal('');
        fs.writeFileSync(path.join(agentDir(), 'settings.json'), '{ "defaultProvider" : "anthropic" }');
        expect(flagFor(home)).to.equal('');
    });

    it('ignores blank pins', () => {
        fs.writeFileSync(path.join(agentDir(), 'settings.json'), '{"defaultModel":""}');
        expect(flagFor(home, { OPENROUTER_API_KEY: 'k' })).to.equal(DEFAULT_FLAG);
    });

    it('leaves Pi to its own choice when the child cannot reach OpenRouter', () => {
        fs.writeFileSync(path.join(agentDir(), 'auth.json'), '{"anthropic":{}}');
        expect(flagFor(home)).to.equal('');
        expect(flagFor(path.join(home, 'empty'))).to.equal('');
    });

    it('reads PI_CODING_AGENT_DIR of the child, not the HOME default', () => {
        const dir = path.join(home, 'custom-agent');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'settings.json'), '{"defaultModel":"x/y"}');
        expect(flagFor(home, { PI_CODING_AGENT_DIR: dir, OPENROUTER_API_KEY: 'k' })).to.equal('');
        expect(flagFor(home, { PI_CODING_AGENT_DIR: path.join(home, 'none'), OPENROUTER_API_KEY: 'k' })).to.equal(DEFAULT_FLAG);
    });
});
