// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    AGENT_PROMPT_WRITE_SCRIPT,
    agentPromptOwnerRunner,
    buildPromptTransportCommand,
    writeAgentPromptFile,
} from './qaap-agent-task-runner-utils';

/**
 * Grok reads its prompt from a file (`--prompt-file`). The backend (root) used to write it into a root-owned
 * 0700 dir, which the agent uid (a different uid under a privilege drop) cannot read. These specs cover the
 * same-uid path and the drop path, where the dir and file must be created AS the agent uid.
 * Changing uid needs root, so the agent-side runner is replaced by one that runs the script locally.
 */
describe('qaap-agent-task-runner-utils prompt file for a dropped agent uid', () => {

    const processUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    const otherUid = (processUid ?? 0) + 1;
    const originalRunner = agentPromptOwnerRunner.run;
    const created: string[] = [];

    afterEach(() => {
        agentPromptOwnerRunner.run = originalRunner;
        for (const dir of created.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('writes the prompt in a root-owned dir when no owner is given or the owner is this process', () => {
        const written = writeAgentPromptFile('hello prompt');
        created.push(written.dir);
        expect(path.dirname(written.dir)).to.equal(os.tmpdir());
        expect(fs.readFileSync(written.file, 'utf8')).to.equal('hello prompt');
        if (processUid !== undefined) {
            expect(fs.statSync(written.dir).uid).to.equal(processUid);
        }
    });

    it('does not call the agent-side runner when the owner is this process', () => {
        let calls = 0;
        agentPromptOwnerRunner.run = () => { calls++; return true; };
        const written = writeAgentPromptFile('same uid', processUid === undefined ? undefined : { uid: processUid });
        created.push(written.dir);
        expect(calls).to.equal(0);
        expect(fs.readFileSync(written.file, 'utf8')).to.equal('same uid');
    });

    it('creates the dir and file as the agent uid and keeps the prompt out of argv', () => {
        const calls: Array<{ owner: { uid: number; gid?: number }; script: string; input: object }> = [];
        agentPromptOwnerRunner.run = (owner, script, input) => {
            calls.push({ owner, script, input });
            return spawnSync(process.execPath, ['-e', script], { input: JSON.stringify(input) }).status === 0;
        };
        const owner = { uid: otherUid, gid: otherUid };
        // The agent-side step runs locally here, so the root-side ownership check refuses the dir; that refusal is
        // the point: root must never hand back a prompt dir it did not see the agent create.
        expect(() => writeAgentPromptFile('secret prompt', owner)).to.throw(/did not create/);
        expect(calls).to.have.length(1);
        expect(calls[0].owner).to.deep.equal(owner);
        expect(calls[0].script).to.equal(AGENT_PROMPT_WRITE_SCRIPT);
        const sent = calls[0].input as { dir: string; file: string; text: string };
        expect(sent.text).to.equal('secret prompt');
        expect(path.dirname(sent.dir)).to.equal(os.tmpdir());
        expect(path.basename(sent.dir)).to.match(/^qaap-agent-prompt-[0-9a-f]{32}$/);
        expect(fs.existsSync(sent.dir)).to.equal(true);
        expect(fs.statSync(sent.dir).mode & 0o777).to.equal(0o700);
        expect(fs.statSync(sent.file).mode & 0o777).to.equal(0o600);
        created.push(sent.dir);
    });

    it('fails closed in buildPromptTransportCommand when the agent-side step fails, never falling back to argv', () => {
        agentPromptOwnerRunner.run = () => false;
        const transported = (): ReturnType<typeof buildPromptTransportCommand> => buildPromptTransportCommand(
            'grok -p {prompt}', 'secret prompt', 'grok', { id: 'grok' }, {}, { uid: otherUid },
        );
        // The agent-side step fails here, so nothing is written by root and the call fails closed.
        expect(transported).to.throw(/as uid/);
    });

    it('fails closed when the agent-side step fails, leaving nothing behind', () => {
        agentPromptOwnerRunner.run = () => false;
        const before = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('qaap-agent-prompt-'));
        expect(() => writeAgentPromptFile('x', { uid: otherUid })).to.throw(/as uid/);
        const after = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('qaap-agent-prompt-'));
        expect(after).to.deep.equal(before);
    });
});
