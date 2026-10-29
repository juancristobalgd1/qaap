// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveQaapReposRoot, resolveUserReposRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QAAP_BUILTIN_AGENT_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import type { QaapHostedWorktreeRegistry } from '@theia/qaap-shared-core/lib/node/qaap-hosted-worktree-registry';
import { buildTemplateVarsExtracted } from './qaap-agent-task-runner-streaming2';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { applyTemplate } from './qaap-agent-task-runner-utils';
import { QaapProjectFolderTrustStore, resolveProjectFolderTrustRoot } from './qaap-project-folder-trust-store';

class TestProjectFolderTrustStore extends QaapProjectFolderTrustStore {
    constructor(protected readonly dbPath: string) {
        super();
    }
    protected override resolveDatabasePath(): string {
        return this.dbPath;
    }
}

/** Only the members buildTemplateVarsExtracted reads for an agent without a model selection. */
function contextTrusting(trustedCwds: readonly string[]): QaapAgentTaskRunnerContext {
    return {
        isProjectFolderTrusted: (_owner: string | undefined, cwd: string) => trustedCwds.includes(cwd),
        resolveQaiqProviderFlags: () => '',
    } as unknown as QaapAgentTaskRunnerContext;
}

const piTemplate = QAAP_BUILTIN_AGENT_DEFINITIONS.find(definition => definition.id === 'pi')?.template ?? '';

describe('qaap agent task runner project folder trust', () => {

    it('passes --approve to Pi for a trusted project folder', () => {
        const vars = buildTemplateVarsExtracted(contextTrusting(['/owned/alice/app']), 'pi', undefined, undefined, 'alice', '/owned/alice/app');
        expect(vars.trust_flags).to.equal('--approve');
        expect(applyTemplate(piTemplate, 'hi', vars)).to.equal('pi -p --approve \'hi\'');
    });

    it('passes --no-approve to Pi while the folder is undecided or untrusted', () => {
        const vars = buildTemplateVarsExtracted(contextTrusting([]), 'pi', undefined, undefined, 'alice', '/owned/alice/app');
        expect(vars.trust_flags).to.equal('--no-approve');
        expect(applyTemplate(piTemplate, 'hi', vars)).to.equal('pi -p --no-approve \'hi\'');
    });

    it('treats a missing project folder as untrusted', () => {
        const vars = buildTemplateVarsExtracted(contextTrusting(['/owned/alice/app']), 'pi', undefined, undefined, 'alice');
        expect(vars.trust_flags).to.equal('--no-approve');
    });

    it('leaves other harnesses without trust flags', () => {
        const vars = buildTemplateVarsExtracted(contextTrusting(['/owned/alice/app']), 'codex', undefined, undefined, 'alice', '/owned/alice/app');
        expect(vars.trust_flags).to.equal('');
    });

    it('never leaks a literal {trust_flags} into a command, even when the vars omit it', () => {
        const vars = buildTemplateVarsExtracted(contextTrusting([]), 'pi', undefined, undefined, 'alice', '/owned/alice/app');
        expect(applyTemplate('pi -p {trust_flags} {prompt}', 'hi', vars)).to.not.contain('{trust_flags}');
        expect(applyTemplate('pi -p {trust_flags} {prompt}', 'hi', {})).to.equal('pi -p \'hi\'');
    });
});

describe('qaap agent task worktrees resolve to their project root', () => {

    let tempDir: string;
    let store: TestProjectFolderTrustStore;
    const savedReposRoot = process.env.QAAP_REPOS_ROOT;
    const savedSqlitePath = process.env.QAAP_SQLITE_STORE_PATH;

    /** Project clone of alice's `acme/app`, and one worktree the backend created from it. */
    const projectRoot = (): string => path.join(resolveUserReposRoot(resolveQaapReposRoot(), 'alice'), 'acme', 'app');
    const taskWorktree = path.join(os.tmpdir(), 'qaap-trust-worktree-a');
    const unrelatedWorktree = path.join(os.tmpdir(), 'qaap-trust-worktree-b');

    const registryFor = (lookup: () => unknown): QaapHostedWorktreeRegistry => ({
        lookup: (_login: string, worktreePath: string) => lookup() ?? (worktreePath === taskWorktree
            ? { login: 'alice', owner: 'acme', repo: 'app' }
            : undefined),
    } as unknown as QaapHostedWorktreeRegistry);

    const varsFor = (registry: QaapHostedWorktreeRegistry | undefined, cwd: string): Record<string, string> => {
        const ctx = {
            isProjectFolderTrusted: (owner: string | undefined, folder: string): boolean => {
                const root = resolveProjectFolderTrustRoot(registry, owner, folder);
                return root !== undefined && store.isTrusted(owner, root);
            },
            resolveQaiqProviderFlags: () => '',
        } as unknown as QaapAgentTaskRunnerContext;
        return buildTemplateVarsExtracted(ctx, 'pi', undefined, undefined, 'alice', cwd);
    };

    beforeEach(() => {
        delete process.env.QAAP_SQLITE_STORE_PATH;
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-trust-root-'));
        process.env.QAAP_REPOS_ROOT = path.join(tempDir, 'repos');
        store = new TestProjectFolderTrustStore(path.join(tempDir, 'state', 'project-folder-trust.sqlite'));
    });

    afterEach(() => {
        if (savedReposRoot === undefined) {
            delete process.env.QAAP_REPOS_ROOT;
        } else {
            process.env.QAAP_REPOS_ROOT = savedReposRoot;
        }
        if (savedSqlitePath === undefined) {
            delete process.env.QAAP_SQLITE_STORE_PATH;
        } else {
            process.env.QAAP_SQLITE_STORE_PATH = savedSqlitePath;
        }
        QaapSqliteConnectionRegistry.shared.closeUnder(tempDir);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('a worktree of a trusted project gets --approve', () => {
        store.record('alice', projectRoot(), true);
        expect(varsFor(registryFor(() => undefined), taskWorktree).trust_flags).to.equal('--approve');
    });

    it('an unrelated worktree gets --no-approve even when another project is trusted', () => {
        store.record('alice', projectRoot(), true);
        expect(varsFor(registryFor(() => undefined), unrelatedWorktree).trust_flags).to.equal('--no-approve');
    });

    it('fails closed to --no-approve when the worktree lookup throws', () => {
        store.record('alice', projectRoot(), true);
        const failing = registryFor(() => {
            throw new Error('registry unavailable');
        });
        expect(varsFor(failing, taskWorktree).trust_flags).to.equal('--no-approve');
    });
});
