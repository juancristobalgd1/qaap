// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { logDetectedAgentsExtracted } from './qaap-agent-task-runner-render2';

const posixIt = process.platform === 'win32' ? it.skip : it;

/** Cold-start guard: the agent detection log runs before the tenant backend listens. */
describe('qaap agent task runner startup probes', function (): void {
    this.timeout(10_000);

    let sandbox: string;
    let qaiq: string;
    let originalLog: typeof console.log;
    let logged: string[];

    beforeEach(() => {
        sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-qaiq-probe-'));
        qaiq = path.join(sandbox, 'qaiq');
        fs.writeFileSync(qaiq, '#!/bin/sh\nsleep 1.5\necho "0.0.0-test (QAIQ)"\n');
        fs.chmodSync(qaiq, 0o755);
        logged = [];
        originalLog = console.log;
        console.log = (...args: unknown[]): void => {
            logged.push(args.map(String).join(' '));
        };
    });

    afterEach(() => {
        console.log = originalLog;
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    posixIt('logs the qaiq version without blocking the event loop', async () => {
        const ctx = { detectedAgents: new Map([['qaiq', {}]]) } as unknown as QaapAgentTaskRunnerContext;

        const started = Date.now();
        logDetectedAgentsExtracted(ctx, () => qaiq);
        const blockedMs = Date.now() - started;

        expect(blockedMs, 'qaiq --version must not run synchronously at startup').to.be.lessThan(750);
        expect(logged.some(line => line.includes('detected agents: qaiq'))).to.equal(true);

        const deadline = Date.now() + 5_000;
        while (!logged.some(line => line.includes('qaiq: 0.0.0-test (QAIQ)')) && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        expect(logged).to.include('[qaap-agent-tasks] qaiq: 0.0.0-test (QAIQ)');
    });
});
