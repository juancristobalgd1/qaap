// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Client-side snapshot of the Work Hub landing that the pre-bundle login gate
 * (`qaap-login-gate.js`) reads to paint a skeleton instantly on the next load.
 *
 * Contract (`localStorage`, key {@link QAAP_WORK_HUB_SHELL_SNAPSHOT_KEY}):
 * `{ "v": 1, "savedAt": <epoch ms>, "login": string, "projects": [{ "name": string, "subtitle"?: string }] }`,
 * at most {@link QAAP_WORK_HUB_SHELL_SNAPSHOT_MAX_PROJECTS} entries, strings truncated to
 * {@link QAAP_WORK_HUB_SHELL_SNAPSHOT_MAX_TEXT} characters. Cleared with the auth session.
 * `login` is required: the gate only paints a snapshot that belongs to the signed-in user.
 * It is a paint hint only, never a surface selector or a source of truth.
 */
export const QAAP_WORK_HUB_SHELL_SNAPSHOT_KEY = 'qaap.workhub.shellSnapshot.v1';
export const QAAP_WORK_HUB_SHELL_SNAPSHOT_MAX_PROJECTS = 12;
export const QAAP_WORK_HUB_SHELL_SNAPSHOT_MAX_TEXT = 80;

export interface QaapWorkHubShellSnapshotProject {
    name: string;
    subtitle?: string;
}

export interface QaapWorkHubShellSnapshot {
    v: 1;
    savedAt: number;
    login: string;
    projects: QaapWorkHubShellSnapshotProject[];
}

function truncateShellSnapshotText(value: string | undefined): string | undefined {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) {
        return undefined;
    }
    return trimmed.length > QAAP_WORK_HUB_SHELL_SNAPSHOT_MAX_TEXT
        ? trimmed.slice(0, QAAP_WORK_HUB_SHELL_SNAPSHOT_MAX_TEXT)
        : trimmed;
}

/** Builds the snapshot value from the projects the landing renders, in display order. */
export function buildQaapWorkHubShellSnapshot(
    projects: readonly QaapWorkHubShellSnapshotProject[],
    login: string,
    savedAt: number = Date.now(),
): QaapWorkHubShellSnapshot {
    const entries: QaapWorkHubShellSnapshotProject[] = [];
    for (const project of projects) {
        if (entries.length >= QAAP_WORK_HUB_SHELL_SNAPSHOT_MAX_PROJECTS) {
            break;
        }
        const name = truncateShellSnapshotText(project.name);
        if (!name) {
            continue;
        }
        const subtitle = truncateShellSnapshotText(project.subtitle);
        entries.push(subtitle ? { name, subtitle } : { name });
    }
    return { v: 1, savedAt, login, projects: entries };
}

function shellSnapshotStorage(): Storage | undefined {
    try {
        return typeof window !== 'undefined' ? window.localStorage ?? undefined : undefined;
    } catch {
        return undefined;
    }
}

/** Last login + project list written by this page, so an unchanged re-render does not rewrite storage. */
let lastWrittenShellSnapshotProjects: string | undefined;

/** Writes the snapshot (skipped when the project list is unchanged). Never throws. */
export function writeQaapWorkHubShellSnapshot(
    projects: readonly QaapWorkHubShellSnapshotProject[],
    login: string | undefined,
): void {
    try {
        const owner = login?.trim();
        const storage = shellSnapshotStorage();
        if (!storage || !owner) {
            // Without an owner the gate would reject the snapshot anyway.
            return;
        }
        const snapshot = buildQaapWorkHubShellSnapshot(projects, owner);
        const projectsJson = JSON.stringify([snapshot.login, snapshot.projects]);
        if (projectsJson === lastWrittenShellSnapshotProjects) {
            return;
        }
        storage.setItem(QAAP_WORK_HUB_SHELL_SNAPSHOT_KEY, JSON.stringify(snapshot));
        lastWrittenShellSnapshotProjects = projectsJson;
    } catch {
        // Quota / privacy mode: the skeleton is a best-effort hint.
    }
}

/** Removes the snapshot (sign-out / expired session). Never throws. */
export function clearQaapWorkHubShellSnapshot(): void {
    lastWrittenShellSnapshotProjects = undefined;
    try {
        shellSnapshotStorage()?.removeItem(QAAP_WORK_HUB_SHELL_SNAPSHOT_KEY);
    } catch {
        // Best effort.
    }
}

/** Debounced {@link writeQaapWorkHubShellSnapshot} for render paths that fire in bursts. */
export class QaapWorkHubShellSnapshotWriter {

    protected timer: ReturnType<typeof setTimeout> | undefined;
    protected pending: { projects: readonly QaapWorkHubShellSnapshotProject[], login: string | undefined } | undefined;

    constructor(protected readonly delayMs: number = 750) { }

    schedule(projects: readonly QaapWorkHubShellSnapshotProject[], login: string | undefined): void {
        this.pending = { projects, login };
        if (this.timer !== undefined) {
            return;
        }
        this.timer = setTimeout(() => this.flush(), this.delayMs);
    }

    flush(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        const pending = this.pending;
        this.pending = undefined;
        if (pending) {
            writeQaapWorkHubShellSnapshot(pending.projects, pending.login);
        }
    }

    dispose(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.pending = undefined;
    }
}
