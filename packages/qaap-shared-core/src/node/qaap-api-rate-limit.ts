// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import type { NextFunction, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { EarlyExpressMiddleware } from '@theia/core/lib/node/backend-application';
import { QAAP_GITHUB_API_PATH } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { QaapFrameCheckRateLimiter } from './qaap-frame-check-guard';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { QAAP_AGENT_CONVERSATION_API_PATH } from '../common/qaap-agent-conversation-client';
import { QAAP_AGENT_TASK_API_PATH } from '../common/qaap-agent-task-client';

const QAAP_API_PREFIX = '/qaap/api/';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RATE_LIMITED_CODE = 'rate_limited';
const RATE_LIMITED_MESSAGE = 'Too many requests. Wait a moment and try again.';

/** Burst and sustained rate of the per-login limit; generous so normal use and e2e never hit it. */
export interface QaapApiRateLimitConfig {
    readonly burst: number;
    readonly refillPerSecond: number;
}

/**
 * Reads `QAAP_API_RATE_LIMIT_BURST` (default 240) and `QAAP_API_RATE_LIMIT_PER_SECOND` (default 10).
 * Either set to `0` disables the limit. Returns `undefined` when disabled.
 */
export function resolveQaapApiRateLimitConfig(env: NodeJS.ProcessEnv = process.env): QaapApiRateLimitConfig | undefined {
    const burst = readNonNegative(env.QAAP_API_RATE_LIMIT_BURST, 240);
    const refillPerSecond = readNonNegative(env.QAAP_API_RATE_LIMIT_PER_SECOND, 10);
    if (burst === 0 || refillPerSecond === 0) {
        return undefined;
    }
    return { burst, refillPerSecond };
}

/**
 * Reads `QAAP_API_EXPENSIVE_RATE_LIMIT_BURST` (default 20) and `QAAP_API_EXPENSIVE_RATE_LIMIT_PER_SECOND`
 * (default 0.2) for the strict bucket on agent-turn and clone routes. Either set to `0` disables it.
 */
export function resolveQaapApiExpensiveRateLimitConfig(env: NodeJS.ProcessEnv = process.env): QaapApiRateLimitConfig | undefined {
    const burst = readNonNegative(env.QAAP_API_EXPENSIVE_RATE_LIMIT_BURST, 20);
    const refillPerSecond = readNonNegative(env.QAAP_API_EXPENSIVE_RATE_LIMIT_PER_SECOND, 0.2);
    if (burst === 0 || refillPerSecond === 0) {
        return undefined;
    }
    return { burst, refillPerSecond };
}

/**
 * Mutations that start an agent turn, call the hosted improve-prompt model or clone a repository. They
 * consume the strict bucket after the general one. Matched on the exact path (optional trailing slash).
 */
const EXPENSIVE_ROUTE_PATTERNS: readonly RegExp[] = [
    new RegExp(`^${escapeRegExp(QAAP_AGENT_CONVERSATION_API_PATH)}/?$`),
    new RegExp(`^${escapeRegExp(QAAP_AGENT_CONVERSATION_API_PATH)}/[^/]+/messages/?$`),
    new RegExp(`^${escapeRegExp(QAAP_AGENT_TASK_API_PATH)}/improve-prompt/?$`),
    new RegExp(`^${escapeRegExp(QAAP_GITHUB_API_PATH)}/repositories/open/?$`),
    new RegExp(`^${escapeRegExp(QAAP_GITHUB_API_PATH)}/repositories/[^/]+/[^/]+/open/?$`),
];

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readNonNegative(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw.trim() === '') {
        return fallback;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Per-login token bucket on every mutating `/qaap/api/*` request (POST/PUT/PATCH/DELETE), so one
 * account cannot flood spawns, writes or agent turns and starve the shared container. Runs as early
 * middleware, before any contribution's routes. Unauthenticated requests pass through untouched (the
 * route answers 401, and the Stripe webhook authenticates by signature); skip-auth dev mode is exempt.
 */
@injectable()
export class QaapApiRateLimitContribution implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(EarlyExpressMiddleware) @optional()
    protected readonly earlyMiddleware?: EarlyExpressMiddleware;

    protected readonly config = resolveQaapApiRateLimitConfig();
    protected readonly limiter = this.config
        ? new QaapFrameCheckRateLimiter(this.config.burst, this.config.refillPerSecond, 10000)
        : undefined;
    protected readonly expensiveConfig = resolveQaapApiExpensiveRateLimitConfig();
    protected readonly expensiveLimiter = this.expensiveConfig
        ? new QaapFrameCheckRateLimiter(this.expensiveConfig.burst, this.expensiveConfig.refillPerSecond, 10000)
        : undefined;

    initialize(): void {
        if (this.limiter) {
            this.earlyMiddleware?.handlers.push(this.handle);
        }
    }

    readonly handle = (req: Request, res: Response, next: NextFunction): void => {
        if ((!this.limiter && !this.expensiveLimiter) || !MUTATING_METHODS.has(req.method) || !req.path.startsWith(QAAP_API_PREFIX)) {
            next();
            return;
        }
        const auth = this.auth.authenticate(req);
        if (auth.kind !== 'authenticated') {
            next();
            return;
        }
        if (this.limiter && !this.limiter.tryTake(auth.userLogin)) {
            this.sendRateLimited(res, this.config!.refillPerSecond);
            return;
        }
        if (this.expensiveLimiter && isExpensiveRoute(req.path) && !this.expensiveLimiter.tryTake(auth.userLogin)) {
            this.sendRateLimited(res, this.expensiveConfig!.refillPerSecond);
            return;
        }
        next();
    };

    protected sendRateLimited(res: Response, refillPerSecond: number): void {
        const retryAfterSeconds = Math.max(1, Math.ceil(1 / refillPerSecond));
        res.set('Retry-After', String(retryAfterSeconds))
            .status(429)
            .json({ error: RATE_LIMITED_MESSAGE, code: RATE_LIMITED_CODE });
    }
}

function isExpensiveRoute(path: string): boolean {
    return EXPENSIVE_ROUTE_PATTERNS.some(pattern => pattern.test(path));
}
