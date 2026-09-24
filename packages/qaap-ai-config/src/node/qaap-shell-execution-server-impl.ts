// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import * as fs from 'fs';
import * as path from 'path';
import { ShellExecutionServerImpl } from '@theia/ai-terminal/lib/node/shell-execution-server-impl';
import { ShellExecutionRequest, ShellExecutionResult } from '@theia/ai-terminal/lib/common/shell-execution-server';
import {
    isPathUnderUserWorkspace,
    isUserWorkspaceContainerPath,
    resolveQaapParallelRoot,
    resolveQaapReposRoot,
    resolveQaapWorktreesRoot,
    resolveUserReposRoot,
    safeUserIdSegment,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { isRealPathUnder } from '@theia/qaap-shared-core/lib/node/qaap-realpath-guard';
import { QaapTenantSpawnService } from '@theia/qaap-cloud-workspace/lib/node/qaap-tenant-spawn-service';
import { QaapWebsocketAuthRegistry } from '@theia/qaap-cloud-workspace/lib/node/qaap-websocket-auth-registry';
import {
    isQaapHostedRuntime,
} from '@theia/qaap-cloud-workspace/lib/node/qaap-docker-control-plane';
import { isQaapSensitiveEnvKey } from '@theia/qaap-cloud-workspace/lib/node/qaap-env-variables';

const DEFAULT_TIMEOUT = 120000;
const MAX_TIMEOUT = 600000;
const MAX_OUTPUT_SIZE = 1024 * 1024;

/**
 * Adds product-level resilience against common LLM `cwd` mistakes:
 *
 * 1. If the model passes the project's basename as a relative `cwd`, treat it as the workspace root.
 *    The naive `path.resolve(workspaceRoot, basename)` would point at a non-existent nested directory
 *    and surface as the misleading `spawn /bin/sh ENOENT` error.
 * 2. If the joined directory does not exist on disk, fail without running the command and tell the
 *    agent which directory was missing (never fall back to a broader directory).
 * 3. If a real ENOENT still leaks through, rewrite the error message to explicitly point at the bad cwd.
 */
@injectable()
export class QaapShellExecutionServerImpl extends ShellExecutionServerImpl {

    @inject(QaapTenantSpawnService) @optional()
    protected readonly tenantSpawn?: QaapTenantSpawnService;

    @inject(QaapWebsocketAuthRegistry) @optional()
    protected readonly connections?: QaapWebsocketAuthRegistry;

    override async execute(request: ShellExecutionRequest): Promise<ShellExecutionResult> {
        if (isQaapHostedRuntime(process.env)) {
            return this.executeInTenantWorker(request);
        }
        const requestedCwd = this.resolveCwd(request.cwd, request.workspaceRoot);
        if (requestedCwd && !this.isExistingDirectory(requestedCwd)) {
            return this.missingCwdResult(requestedCwd);
        }
        const result = await super.execute(request);
        if (!result.success && result.error && /ENOENT/.test(result.error) && result.resolvedCwd) {
            let cwdExists = false;
            try {
                cwdExists = fs.statSync(result.resolvedCwd).isDirectory();
            } catch {
                cwdExists = false;
            }
            if (!cwdExists) {
                return {
                    ...result,
                    error: `Working directory does not exist: ${result.resolvedCwd}. ` +
                        'Pass a different cwd (or omit it to use the workspace root).'
                };
            }
        }
        return result;
    }

    override async cancel(executionId: string): Promise<boolean> {
        if (!isQaapHostedRuntime(process.env)) {
            return super.cancel(executionId);
        }
        const owner = this.requireTenantOwner();
        return super.cancel(this.scopedExecutionId(owner, executionId));
    }

    protected async executeInTenantWorker(request: ShellExecutionRequest): Promise<ShellExecutionResult> {
        const owner = this.requireTenantOwner();
        const resolvedCwd = this.resolveCwd(request.cwd, request.workspaceRoot);
        // Authorization runs first so existence of other tenants' paths is never revealed; a
        // missing directory is only reported when it lies lexically inside the caller's own tree.
        if (resolvedCwd && !this.isExistingDirectory(resolvedCwd) && this.isInsideOwnTenantTree(resolvedCwd, owner)) {
            return this.missingCwdResult(resolvedCwd);
        }
        if (!resolvedCwd || !this.isAllowedTenantCwd(resolvedCwd, owner)) {
            throw new Error('Shell execution is restricted to the authenticated tenant workspace.');
        }
        if (!this.tenantSpawn) {
            throw new Error('Tenant worker execution is unavailable.');
        }

        const effectiveTimeout = Math.min(Math.max(request.timeout ?? DEFAULT_TIMEOUT, 1), MAX_TIMEOUT);
        const executionId = request.executionId ? this.scopedExecutionId(owner, request.executionId) : undefined;
        const env = Object.fromEntries(
            Object.entries(process.env).filter(([key, value]) => value !== undefined && !isQaapSensitiveEnvKey(key)),
        );
        // The parent-side docker exec needs the rootless control-plane endpoint. Docker exec does
        // not forward the parent environment into the tenant process, so this does not expose the
        // socket path to the untrusted command.
        if (process.env.DOCKER_HOST) {
            env.DOCKER_HOST = process.env.DOCKER_HOST;
        }
        const start = Date.now();
        const child = await this.tenantSpawn.spawnPreparedAsync(request.command, {
            cwd: resolvedCwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
        });
        if (executionId) {
            this.runningProcesses.set(executionId, child);
        }

        return new Promise<ShellExecutionResult>(resolve => {
            let stdout = '';
            let stderr = '';
            let killed = false;
            const append = (target: 'stdout' | 'stderr', data: Buffer): void => {
                if (target === 'stdout' && stdout.length < MAX_OUTPUT_SIZE) {
                    stdout += data.toString().slice(0, MAX_OUTPUT_SIZE - stdout.length);
                }
                if (target === 'stderr' && stderr.length < MAX_OUTPUT_SIZE) {
                    stderr += data.toString().slice(0, MAX_OUTPUT_SIZE - stderr.length);
                }
            };
            child.stdout?.on('data', (data: Buffer) => append('stdout', data));
            child.stderr?.on('data', (data: Buffer) => append('stderr', data));
            const timeoutId = setTimeout(() => {
                killed = true;
                this.killProcessTree(child);
            }, effectiveTimeout);
            const finish = (result: ShellExecutionResult): void => {
                clearTimeout(timeoutId);
                if (executionId) {
                    this.runningProcesses.delete(executionId);
                    this.canceledExecutions.delete(executionId);
                }
                resolve(result);
            };
            child.on('close', (code, signal) => {
                const duration = Date.now() - start;
                const canceled = executionId ? this.canceledExecutions.has(executionId) : false;
                if (signal || killed) {
                    finish({
                        success: false,
                        exitCode: undefined,
                        stdout,
                        stderr,
                        error: canceled ? 'Command canceled by user' : `Command timed out after ${effectiveTimeout}ms`,
                        duration,
                        canceled,
                        resolvedCwd,
                    });
                } else {
                    finish({
                        success: code === 0,
                        exitCode: code ?? undefined,
                        stdout,
                        stderr,
                        duration,
                        resolvedCwd,
                    });
                }
            });
            child.on('error', error => finish({
                success: false,
                exitCode: undefined,
                stdout,
                stderr,
                error: error.message,
                duration: Date.now() - start,
                resolvedCwd,
            }));
        });
    }

    protected requireTenantOwner(): string {
        const owner = this.connections?.getCurrentLogin()?.trim().toLowerCase();
        if (!owner) {
            throw new Error('Shell execution requires an authenticated tenant.');
        }
        return owner;
    }

    protected scopedExecutionId(owner: string, executionId: string): string {
        return `${owner}:shell:${executionId}`;
    }

    protected isAllowedTenantCwd(cwd: string, owner: string): boolean {
        const reposRoot = resolveQaapReposRoot();
        const userRoot = resolveUserReposRoot(reposRoot, owner);
        if (isPathUnderUserWorkspace(cwd, reposRoot, owner)
            && !isUserWorkspaceContainerPath(cwd, reposRoot, owner)
            && isRealPathUnder(cwd, userRoot)) {
            return true;
        }
        const segment = safeUserIdSegment(owner);
        return [resolveQaapWorktreesRoot(), resolveQaapParallelRoot()]
            .map(root => path.join(root, segment))
            .some(root => isRealPathUnder(cwd, root));
    }

    protected override resolveCwd(requestedCwd: string | undefined, workspaceRoot: string | undefined): string | undefined {
        if (!requestedCwd) {
            return workspaceRoot;
        }
        if (path.isAbsolute(requestedCwd)) {
            return requestedCwd;
        }
        if (!workspaceRoot) {
            return requestedCwd;
        }
        if (requestedCwd === path.basename(workspaceRoot) || requestedCwd === `./${path.basename(workspaceRoot)}`) {
            return workspaceRoot;
        }
        // Never substitute a different directory for a missing one: a command meant for a
        // subdirectory (e.g. `git clean -fdx .`) must not silently run at the workspace root.
        return path.resolve(workspaceRoot, requestedCwd);
    }

    /** Lexical (no realpath) check that `cwd` is inside one of the tenant's own roots. */
    protected isInsideOwnTenantTree(cwd: string, owner: string): boolean {
        if (isPathUnderUserWorkspace(cwd, resolveQaapReposRoot(), owner)) {
            return true;
        }
        const segment = safeUserIdSegment(owner);
        const target = path.resolve(cwd);
        return [resolveQaapWorktreesRoot(), resolveQaapParallelRoot()]
            .map(root => path.join(root, segment))
            .some(root => {
                const relative = path.relative(root, target);
                return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
            });
    }

    protected isExistingDirectory(candidate: string): boolean {
        try {
            return fs.statSync(candidate).isDirectory();
        } catch {
            return false;
        }
    }

    protected missingCwdResult(resolvedCwd: string): ShellExecutionResult {
        return {
            success: false,
            exitCode: undefined,
            stdout: '',
            stderr: '',
            error: `Working directory does not exist: ${resolvedCwd}. ` +
                'Pass an existing cwd (or omit it to use the workspace root). The command was not run.',
            duration: 0,
            resolvedCwd,
        };
    }
}
