// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { ChildProcess } from 'child_process';

/**
 * DI seam for product endpoints that need to run a tenant-owned executable.
 *
 * The interface lives in the dependency-light adapter package so product packages such as the
 * mobile shell do not depend back on `qaap-cloud-workspace` (which already consumes them). The
 * cloud package binds this token to QaapTenantSpawnService; local-only applications may leave it
 * unbound and keep their existing single-user process path.
 */
export const QaapTenantProcessExecutor = Symbol('QaapTenantProcessExecutor');

export interface QaapTenantProcessExecutor {
    spawnArgvPreparedAsync(
        file: string,
        args: readonly string[],
        options: {
            cwd: string;
            env: NodeJS.ProcessEnv;
            stdio: ('pipe' | 'ignore')[];
            detached?: boolean;
        },
    ): Promise<ChildProcess>;
    resolveProcessEnv(cwd: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
}
