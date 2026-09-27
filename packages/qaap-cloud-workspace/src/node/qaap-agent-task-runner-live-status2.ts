// Extracted from qaap-agent-task-runner.ts
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';

import {
    runOneShotCommand as runOneShotCommandHelper,
} from './qaap-agent-task-runner-utils3';

export function runOneShotCommandExtracted(ctx: QaapAgentTaskRunnerContext, command: string,
        cwd: string,
        env: NodeJS.ProcessEnv,
        agentId?: string,
        timeoutMs = 45_000,
        stdinPrompt?: string,
        promptTempDir?: string,): Promise<string> {
        return runOneShotCommandHelper(command, cwd, env, agentId, timeoutMs, {
            enforceAgentIsolationPolicy: () => ctx.enforceAgentIsolationPolicy(),
            ensureAgentCwdOwnership: c => ctx.ensureAgentCwdOwnershipAsync
                ? ctx.ensureAgentCwdOwnershipAsync(c)
                : ctx.ensureAgentCwdOwnership(c),
            spawnAgentCommand: (cmd, opts) => ctx.spawnAgentCommand(cmd, opts),
            killAgentProcessTree: c => ctx.killAgentProcessTree(c),
            reapAgentProcessGroupAfterExit: c => ctx.reapAgentProcessGroupAfterExit(c),
        }, stdinPrompt, promptTempDir);
}

