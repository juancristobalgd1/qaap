// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapUserFacingErrors } from '@theia/qaap-adapters/lib/common/qaap-user-facing-error';

/** `GET` lists; `PUT` / `DELETE` `/:owner/:repo` turn GitHub issue tasks on / off (doc/qaap-external-task-inputs.md). */
export const QAAP_EXTERNAL_TASK_GITHUB_OPT_IN_PATH = '/qaap/api/external-tasks/github/opt-in';

/**
 * The signed-in user's per-repository opt-in for tasks started from GitHub issues, as the Work Hub sees it.
 * `available` is false while the server has the feature off (404), and the menu then hides the toggle.
 */
export class QaapExternalTaskOptInClient {

    protected repositories: Set<string> | undefined;
    protected loading: Promise<void> | undefined;
    protected featureAvailable = false;

    get available(): boolean {
        return this.featureAvailable;
    }

    /** Loads once; later calls return the same promise. A failure leaves the feature hidden. */
    load(): Promise<void> {
        if (!this.loading) {
            this.loading = this.fetchRepositories().catch(() => {
                this.featureAvailable = false;
            });
        }
        return this.loading;
    }

    isEnabled(owner: string, repo: string): boolean {
        return !!this.repositories?.has(`${owner}/${repo}`.toLowerCase());
    }

    async setEnabled(owner: string, repo: string, enabled: boolean): Promise<void> {
        const response = await fetch(`${QAAP_EXTERNAL_TASK_GITHUB_OPT_IN_PATH}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
            method: enabled ? 'PUT' : 'DELETE',
            credentials: 'include',
        });
        if (!response.ok) {
            throw await QaapUserFacingErrors.fromResponse(response);
        }
        const key = `${owner}/${repo}`.toLowerCase();
        this.repositories ??= new Set();
        if (enabled) {
            this.repositories.add(key);
        } else {
            this.repositories.delete(key);
        }
    }

    protected async fetchRepositories(): Promise<void> {
        const response = await fetch(QAAP_EXTERNAL_TASK_GITHUB_OPT_IN_PATH, { credentials: 'include' });
        if (!response.ok) {
            this.featureAvailable = false;
            return;
        }
        const body = await response.json() as { repositories?: { repository?: string }[] };
        this.repositories = new Set((body.repositories ?? []).map(entry => (entry.repository ?? '').toLowerCase()).filter(Boolean));
        this.featureAvailable = true;
    }
}
