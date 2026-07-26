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
    constructor(protected readonly failingScripts: ReadonlySet<string>, protected readonly output?: string) { super(); }
    readonly ran: string[] = [];
    protected override async runVerificationScript(_context: QaapJobFunctionContext, script: string): Promise<string | undefined> {
        this.ran.push(script);
        return this.failingScripts.has(script) ? (this.output ?? `npm run ${script} failed`) : undefined;
    }
    /** Exposes the real failure formatter, which the stub above bypasses. */
    describe(error: unknown): string {
        return this.describeScriptFailure(error);
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

    function verifyDefinition(failing: string[] = [], output?: string): { definition: QaapJobFunctionDefinition; contribution: TestVerifyFunctions } {
        const { registry, definitions } = buildRegistry();
        const contribution = new TestVerifyFunctions(new Set(failing), output);
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

    describe('what the fix turn is handed', () => {
        it('publishes the failing output as the node artifact', async () => {
            // Without this the failure is captured, kept in the job result, and never seen again:
            // the fix turn is told to read a failure the prompt does not contain.
            writePackageJson({ build: 'tsc -b' });
            const { definition } = verifyDefinition(['build'], 'src/cart.ts(12,5): error TS2345: string is not number');
            const result = await definition.execute(context(dir), {}) as { artifact?: string };
            expect(result.artifact).to.contain('npm run build');
            expect(result.artifact).to.contain('error TS2345');
        });

        it('keeps the END of a long log, where the reason for the exit code is', async () => {
            writePackageJson({ build: 'tsc -b' });
            const noise = 'npm banner line\n'.repeat(4000);
            const { definition } = verifyDefinition(['build'], `${noise}Found 12 errors in 3 files.`);
            const result = await definition.execute(context(dir), {}) as { artifact?: string };
            expect(result.artifact).to.contain('Found 12 errors');
            expect(result.artifact).to.contain('earlier output trimmed');
            expect(result.artifact!.length).to.be.lessThan(noise.length);
        });

        it('publishes nothing when the workspace verifies cleanly', async () => {
            writePackageJson({ build: 'tsc -b' });
            const { definition } = verifyDefinition();
            const result = await definition.execute(context(dir), {}) as { artifact?: string };
            expect(result.artifact).to.equal(undefined);
        });

        it('captures stdout, where the compilers this repository verifies with report', async () => {
            // `error.message` from execFile is 'Command failed: …' plus STDERR only, and tsc/mocha
            // print their diagnostics on stdout: message-only means "something failed", nothing more.
            const { contribution } = verifyDefinition();
            const described = contribution.describe(Object.assign(
                new Error('Command failed: npm run build\nnpm ERR! code 2'),
                { stdout: 'src/cart.ts(12,5): error TS2345', stderr: 'npm ERR! code 2' },
            ));
            expect(described).to.contain('error TS2345');
            // stderr is already inside the message; repeating it just pushes the useful part away.
            expect(described.split('npm ERR! code 2')).to.have.lengthOf(2);
        });
    });
});
