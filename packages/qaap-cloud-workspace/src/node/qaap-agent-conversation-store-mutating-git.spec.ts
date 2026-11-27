// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { mutatingGitExtracted } from './qaap-agent-conversation-store-render2';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

describe('mutatingGitExtracted', () => {
    it('forwards throwaway GIT_INDEX_FILE into tenantSpawn.wrapShellForTenant so snapshots never mutate the real git index', async () => {
        let forwardedEnv: NodeJS.ProcessEnv | undefined;
        const ctx = {
            tenantSpawn: {
                wrapShellForTenant: (_cwd: string, _file: string, _args: readonly string[], env?: NodeJS.ProcessEnv) => {
                    forwardedEnv = env;
                    return { file: process.execPath, args: ['-e', 'process.exit(0)'] };
                },
                tenantHomeEnvOverlay: () => ({}),
            },
        } as unknown as QaapAgentConversationStoreContext;

        const tmpIndex = '/tmp/qaap-ckpt-test.index';
        const result = await mutatingGitExtracted(ctx, process.cwd(), ['add', '-A'], {
            ...process.env,
            GIT_INDEX_FILE: tmpIndex,
        });
        expect(result.status).to.equal(0);
        expect(forwardedEnv?.GIT_INDEX_FILE).to.equal(tmpIndex);
    });
});
