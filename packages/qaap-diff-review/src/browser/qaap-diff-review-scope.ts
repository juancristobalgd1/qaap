// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_GIT_REVIEW_API_PATH } from '@theia/qaap-shared-core/lib/common/qaap-git-review';

/**
 * What the Changes view measures:
 * - `task`: the working tree against the conversation's task baseline (pre-turn snapshot of its first message);
 * - `uncommitted`: the working tree against `HEAD` (every uncommitted change of the repository).
 *
 * Both are served by the existing `/changes` and `/diff` endpoints (with and without `baseCommit`).
 */
export type QaapDiffReviewScope = 'task' | 'uncommitted';

export namespace QaapDiffReviewScope {

    /** Scopes the view can offer: the task scope needs a baseline the server has not rejected. */
    export function available(baselineCommit: string | undefined, baselineRejected: boolean): QaapDiffReviewScope[] {
        return baselineCommit && !baselineRejected ? ['task', 'uncommitted'] : ['uncommitted'];
    }

    /** The requested scope when it is available, otherwise the first available one. */
    export function resolve(
        requested: QaapDiffReviewScope | undefined,
        baselineCommit: string | undefined,
        baselineRejected: boolean,
    ): QaapDiffReviewScope {
        const scopes = available(baselineCommit, baselineRejected);
        return requested && scopes.includes(requested) ? requested : scopes[0];
    }

    /** `baseCommit` sent to the review endpoints for a scope, or `undefined` for a `HEAD`-relative diff. */
    export function baseCommit(
        scope: QaapDiffReviewScope,
        baselineCommit: string | undefined,
        baselineRejected: boolean,
    ): string | undefined {
        return resolve(scope, baselineCommit, baselineRejected) === 'task' ? baselineCommit : undefined;
    }

    /** `/changes` request URL for a repository root and optional base commit. */
    export function changesUrl(root: string, base: string | undefined): string {
        return `${QAAP_GIT_REVIEW_API_PATH}/changes?root=${encodeURIComponent(root)}`
            + (base ? `&baseCommit=${encodeURIComponent(base)}` : '');
    }

    /** `/diff` request URL for one repository-relative file. */
    export function diffUrl(root: string, file: string, base: string | undefined): string {
        return `${QAAP_GIT_REVIEW_API_PATH}/diff?root=${encodeURIComponent(root)}&file=${encodeURIComponent(file)}`
            + (base ? `&baseCommit=${encodeURIComponent(base)}` : '');
    }

    /** Abbreviated commit id for labels (`git rev-parse --short` length). */
    export function shortCommit(sha: string): string {
        return sha.slice(0, 7);
    }
}
