// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapJobFunctionContext, QaapJobFunctionDefinition, QaapJobFunctionRegistry } from './qaap-job-function-registry';
import { QAAP_WORKFLOW_VERIFY_FUNCTION, QaapWorkflowJobFunctions } from './qaap-workflow-job-functions';

/** Captures registered definitions without the DI container. */
function buildRegistry(): { registry: QaapJobFunctionRegistry; definitions: Map<string, QaapJobFunctionDefinition> } {
    const definitions = new Map<string, QaapJobFunctionDefinition>();
    const registry = Object.create(QaapJobFunctionRegistry.prototype) as QaapJobFunctionRegistry;
    Object.assign(registry, { definitions });
    return { registry, definitions };
}

/** Verify contribution whose script runner is stubbed, so no npm process is spawned. */
class TestVerifyFunctions extends QaapWorkflowJobFunctions {
    constructor(protected readonly failingScripts: ReadonlySet<string>) { super(); }
    readonly ran: string[] = [];
    protected override async runVerificationScript(_context: QaapJobFunctionContext, script: string): Promise<string | undefined> {
        this.ran.push(script);
        return this.failingScripts.has(script) ? `npm run ${script} failed` : undefined;
    }
}

function context(cwd: string): QaapJobFunctionContext {
    return {
        jobId: 'job', cwd, signal: new AbortController().signal,
        emitOutput: () => undefined,
        resolveWorkspacePath: async relativePath => path.join(cwd, relativePath),
    };
}

describe('QaapWorkflowJobFunctions.verify', () => {
    let dir: string;

    beforeEach(() => dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-workflow-verify-')));
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    function verifyDefinition(failing: string[] = []): { definition: QaapJobFunctionDefinition; contribution: TestVerifyFunctions } {
        const { registry, definitions } = buildRegistry();
        const contribution = new TestVerifyFunctions(new Set(failing));
        contribution.registerFunctions(registry);
        return { definition: definitions.get(QAAP_WORKFLOW_VERIFY_FUNCTION)!, contribution };
    }

    function writePackageJson(scripts: Record<string, string>): void {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', scripts }));
    }

    it('runs typecheck, build, test, lint in that order and succeeds when all pass', async () => {
        writePackageJson({ lint: 'eslint', test: 'mocha', build: 'tsc -b', typecheck: 'tsc --noEmit' });
        const { definition, contribution } = verifyDefinition();
        const result = await definition.execute(context(dir), {}) as { outcome: string; scripts: string[] };
        expect(result.outcome).to.equal('success');
        expect(contribution.ran).to.deep.equal(['typecheck', 'build', 'test', 'lint']);
    });

    it('stops at the first failing script and reports it', async () => {
        writePackageJson({ typecheck: 'tsc --noEmit', build: 'tsc -b', test: 'mocha' });
        const { definition, contribution } = verifyDefinition(['build']);
        const result = await definition.execute(context(dir), {}) as { outcome: string; failedScript: string };
        expect(result.outcome).to.equal('fail');
        expect(result.failedScript).to.equal('build');
        // 'test' after the failing 'build' never runs.
        expect(contribution.ran).to.deep.equal(['typecheck', 'build']);
    });

    it('succeeds with nothing to run when there are no verification scripts', async () => {
        writePackageJson({ start: 'node .' });
        const { definition, contribution } = verifyDefinition();
        const result = await definition.execute(context(dir), {}) as { outcome: string; scripts: string[] };
        expect(result.outcome).to.equal('success');
        expect(result.scripts).to.deep.equal([]);
        expect(contribution.ran).to.deep.equal([]);
    });

    it('succeeds when there is no package.json at all', async () => {
        const { definition } = verifyDefinition();
        const result = await definition.execute(context(dir), {}) as { outcome: string };
        expect(result.outcome).to.equal('success');
    });
});
