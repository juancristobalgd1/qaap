// @ts-nocheck
// Extracted from mobile-projects-service.ts

import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { LabelProvider } from '@theia/core/lib/browser';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { SingleTextInputDialog } from '@theia/core/lib/browser/dialogs';
import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import {
    cloneQaapGithubRepository,
    createQaapGithubRepository,
    fetchQaapAuthConfig,
    fetchQaapGithubRepositories,
    fetchQaapProjectSessions,
    openQaapGithubRepository,
    syncQaapAuthSessionFromServer,
    upsertQaapProjectSession,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type {
    QaapProjectSessionSummary,
    QaapProjectSessionUpsertRequest,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { readQaapAuthUser, readQaapSignedIn, type QaapAuthUser } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import type { QaapGithubRepositorySummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    MobileProjectEntry,
    MobileProjectFilter,
    MobileProjectsHubView,
    mobileProjectColorForName,
    mobileProjectInitials,
    StoredMobileProject,
} from './mobile-projects-types';
import { normalizeWorkHubViewId } from '../common/qaap-work-hub-surfaces';
import { findProjectMatchingWorkspaceCwd } from '../common/qaap-composer-workspace-project';
import { isValidHubUserRepositoryProjectCandidate } from '../common/qaap-hub-project-eligibility';
import { MobileProjectsActiveTasks } from './mobile-projects-active-tasks';
import {
    clearMobileProjectReadmeOpenRequest,
    markMobileProjectReadmeForOpen,
    markMobileProjectsPanelDismiss,
    requestMobileProjectsPanelDismiss,
} from './mobile-projects-open';
import { MobileSnackbar } from './mobile-snackbar';
import {
    mergeSessionMaps,
    patchLocalProjectSession,
    readLocalProjectSessions,
    writeLocalProjectSessions,
} from './mobile-projects-session-cache';
import { deduplicateMobileProjectEntries } from './mobile-projects-dedup';
import {
    MOBILE_PROJECTS_CUSTOM_PROJECTS_BASE,
    MOBILE_PROJECTS_DISPLAY_NAMES_BASE,
    MOBILE_PROJECTS_HIDDEN_IDS_BASE,
    MOBILE_PROJECTS_PINNED_IDS_BASE,
    mobileProjectsUserStorageKey,
} from './mobile-projects-user-storage';
import { parseGithubFullNameFromWorkspacePath } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

export async function prepareProjectCwdExtracted(ctx: any, project: MobileProjectEntry): Promise<string | undefined> {
        const existing = ctx.getProjectCwd(project);
        if (existing) {
            return existing;
        }
        // Deliberately no readQaapSignedIn() gate here: the localStorage hint can lag the real
        // session (observed live: hint false while the authenticated hub was working), and an
        // instant-undefined here bricks every composer submit for hosted projects. The /open
        // fetch itself is the authority — signed-out just fails it with a 401.
        if (!project.github) {
            return undefined;
        }
        try {
            const result = await openQaapGithubRepository(project.github.owner, project.github.name);
            return ctx.cwdFromFileUri(new URI(result.workspaceUri));
        } catch {
            return undefined;
        }
}

export function cwdFromFileUriExtracted(ctx: any, uri: URI | undefined): string | undefined {
        if (!uri || uri.scheme !== 'file') {
            return undefined;
        }
        const raw = uri.path.toString();
        const fsPath = /^\/[A-Za-z]:/.test(raw) ? raw.slice(1) : raw;
        return isQaapWorkspaceContainerPath(fsPath) ? undefined : fsPath;
}

export async function recordProjectSessionExtracted(ctx: any, patch: Omit<QaapProjectSessionUpsertRequest, 'repoKey'> & { repoKey?: string }): Promise<void> {
        const repoKey = patch.repoKey ?? ctx.currentRepoKey();
        if (!repoKey) {
            return;
        }
        const row: QaapProjectSessionSummary = {
            repoKey,
            branch: patch.branch ?? 'main',
            tokens: patch.tokens,
            cost: patch.cost,
            agentState: patch.agentState,
            lastTask: patch.lastTask,
            previewUrl: patch.previewUrl,
            bootstrapPhase: patch.bootstrapPhase,
            lastActiveAt: new Date().toISOString(),
        };
        patchLocalProjectSession(row);
        if (readQaapSignedIn()) {
            await upsertQaapProjectSession(row).catch(() => undefined);
        }
}

export async function recordProjectPreviewUrlExtracted(ctx: any, project: MobileProjectEntry, previewUrl: string): Promise<void> {
        const repoKey = ctx.projectSessionKey(project);
        if (!repoKey) {
            return;
        }
        await ctx.recordProjectSession({
            repoKey,
            branch: project.branch || 'main',
            previewUrl,
        });
}

export async function resolveProjectPreviewUrlExtracted(ctx: any, project: MobileProjectEntry, cwd?: string): Promise<string | undefined> {
        const repoKey = ctx.projectSessionKey(project);
        const cwdRepoKey = cwd ? `ws:${new URI(cwd).withScheme('file').toString()}` : undefined;
        if (!repoKey && !cwdRepoKey) {
            return project.previewUrl;
        }
        const sessions = await ctx.loadSessionMap();
        return (repoKey ? sessions.get(repoKey)?.previewUrl : undefined)
            ?? (cwdRepoKey ? sessions.get(cwdRepoKey)?.previewUrl : undefined)
            ?? project.previewUrl;
}

export function touchProjectActivityExtracted(ctx: any, project: MobileProjectEntry): void {
        const repoKey = ctx.projectSessionKey(project);
        if (!repoKey) {
            return;
        }
        ctx.touchProjectSession(repoKey, project.branch);
}

export function touchProjectSessionExtracted(ctx: any, repoKey: string, branch: string): void {
        const row: QaapProjectSessionSummary = {
            repoKey,
            branch: branch || 'main',
            lastActiveAt: new Date().toISOString(),
        };
        patchLocalProjectSession(row);
        if (readQaapSignedIn()) {
            void upsertQaapProjectSession(row).catch(() => undefined);
        }
}

export function projectSessionKeyExtracted(ctx: any, project: MobileProjectEntry): string | undefined {
        if (project.github) {
            return `github:${project.github.fullName}`;
        }
        return project.uri ? `ws:${project.uri.toString()}` : undefined;
}

export function currentRepoKeyExtracted(ctx: any): string | undefined {
        const fullName = ctx.currentGithubRepositoryFullName();
        if (fullName) {
            return `github:${fullName}`;
        }
        const uri = ctx.workspaceService.workspace?.resource;
        return uri ? `ws:${uri.toString()}` : undefined;
}

export function getProjectWorkspaceMatchKeyExtracted(ctx: any, project: MobileProjectEntry): string | undefined {
        if (project.github) {
            return `github:${project.github.fullName.toLowerCase()}`;
        }
        return project.uri ? `ws:${project.uri.toString()}` : undefined;
}

export function getCurrentWorkspaceMatchKeyExtracted(ctx: any): string | undefined {
        const fullName = ctx.currentGithubRepositoryFullName();
        if (fullName) {
            return `github:${fullName}`;
        }
        const uri = ctx.workspaceService.workspace?.resource;
        return uri ? `ws:${uri.toString()}` : undefined;
}

export function projectMatchesCurrentWorkspaceExtracted(ctx: any, project: MobileProjectEntry): boolean {
        if (project.isCurrent) {
            return true;
        }
        const projectKey = ctx.getProjectWorkspaceMatchKey(project);
        return !!projectKey && projectKey === ctx.getCurrentWorkspaceMatchKey();
}

export function resolveCurrentWorkspaceProjectExtracted(ctx: any, projects: readonly MobileProjectEntry[]): MobileProjectEntry | undefined {
        const workspaceCwd = ctx.getCurrentWorkspaceCwd();
        const matched = findProjectMatchingWorkspaceCwd(
            projects,
            workspaceCwd,
            project => ctx.getProjectCwd(project),
            project => ctx.projectMatchesCurrentWorkspace(project),
        );
        if (matched) {
            return matched;
        }
        if (ctx.isProjectContainerWorkspace(workspaceCwd, projects)) {
            // The open workspace is the folder that CONTAINS the user's
            // projects (the multi-repo workspaces root on hosted deployments).
            // Never fabricate it as a targetable "project": an agent turn with
            // that cwd would ingest every repository at once — wrong scope and
            // a massive LLM context. Callers fall back to the pinned/first
            // real project instead.
            return undefined;
        }
        return ctx.buildEphemeralCurrentWorkspaceEntry();
}

export function isProjectContainerWorkspaceExtracted(ctx: any, workspaceCwd: string | undefined,
        projects: readonly MobileProjectEntry[],): boolean {
        if (!workspaceCwd) {
            return false;
        }
        const prefix = workspaceCwd.endsWith('/') ? workspaceCwd : `${workspaceCwd}/`;
        return projects.some(project => {
            const cwd = ctx.getProjectCwd(project);
            return !!cwd && cwd !== workspaceCwd && cwd.startsWith(prefix);
        });
}

export function buildEphemeralCurrentWorkspaceEntryExtracted(ctx: any): MobileProjectEntry | undefined {
        const uri = ctx.workspaceService.workspace?.resource;
        if (!uri || uri.scheme !== 'file' || !ctx.cwdFromFileUri(uri)) {
            // No usable repository cwd (e.g. the open workspace is the container of every repo):
            // never surface it as a targetable project.
            return undefined;
        }
        const id = `ws:${uri.toString()}`;
        const name = ctx.resolveDisplayName(id, ctx.labelProvider.getName(uri));
        return {
            id,
            name,
            color: mobileProjectColorForName(name),
            branch: uri.path.base,
            status: 'working',
            task: nls.localize('qaap/mobileProjects/currentTask', 'Active workspace'),
            progress: 0.35,
            agents: [{ role: 'ai', color: '#3B6FA0' }],
            lastActive: nls.localize('qaap/mobileProjects/lastActiveNow', 'now'),
            lastActiveAt: new Date().toISOString(),
            tokens: '—',
            cost: '—',
            pinned: false,
            uri,
            isCurrent: true,
        };
}

export async function loadSessionMapExtracted(ctx: any): Promise<Map<string, QaapProjectSessionSummary>> {
        const local = readLocalProjectSessions();
        const config = await fetchQaapAuthConfig().catch(() => ({ skipAuth: false, githubOAuth: false }));
        if (!config.skipAuth) {
            if (readQaapSignedIn()) {
                await syncQaapAuthSessionFromServer();
            }
            if (!readQaapSignedIn()) {
                return local;
            }
        }
        try {
            const remote = await fetchQaapProjectSessions();
            const remoteMap = new Map(remote.sessions.map(s => [s.repoKey, s]));
            const merged = mergeSessionMaps(local, remoteMap);
            writeLocalProjectSessions(merged);
            return merged;
        } catch {
            return local;
        }
}

export function applySessionToEntryExtracted(ctx: any, entry: MobileProjectEntry, session?: QaapProjectSessionSummary): MobileProjectEntry {
        if (!session) {
            return entry;
        }
        const status = session.agentState ?? entry.status;
        const lastActiveAt = ctx.latestTimestamp(entry.lastActiveAt, session.lastActiveAt);
        return {
            ...entry,
            branch: session.branch || entry.branch,
            status,
            task: session.lastTask?.trim() || entry.task,
            tokens: session.tokens ?? entry.tokens,
            cost: session.cost ?? entry.cost,
            lastActive: lastActiveAt ? ctx.relativeUpdatedAt(lastActiveAt) : entry.lastActive,
            lastActiveAt,
            previewUrl: session.previewUrl ?? entry.previewUrl,
            progress: status === 'working' ? Math.max(entry.progress, 0.2) : entry.progress,
            agents: status === 'working' || status === 'review'
                ? (entry.agents.length > 0 ? entry.agents : [{ role: 'ai', color: '#3B6FA0' }])
                : entry.agents,
        };
}

export async function loadGithubProjectsExtracted(ctx: any, sessionMap: Map<string, QaapProjectSessionSummary>, includeUnopened: boolean): Promise<MobileProjectEntry[]> {
        if (!readQaapSignedIn()) {
            return [];
        }
        try {
            const response = await fetchQaapGithubRepositories();
            const pinnedIds = ctx.readPinnedProjectIds();
            const currentFullName = ctx.currentGithubRepositoryFullName();
            const openedRepoKeys = new Set([...sessionMap.keys()].map(key => key.toLowerCase()));
            return response.repositories
                .filter(repo => includeUnopened
                    || repo.fullName.toLowerCase() === currentFullName
                    || openedRepoKeys.has(`github:${repo.fullName}`.toLowerCase()))
                .map(repo => ctx.applySessionToEntry(
                    ctx.githubRepositoryToProject(repo, pinnedIds, currentFullName),
                    sessionMap.get(`github:${repo.fullName}`) ?? sessionMap.get(`github:${repo.fullName.toLowerCase()}`)
                ));
        } catch (err) {
            console.warn('[qaap] Failed to load GitHub repositories:', err);
            return [];
        }
}

export function currentGithubRepositoryFullNameExtracted(ctx: any): string | undefined {
        const current = ctx.workspaceService.workspace?.resource;
        if (!current) {
            return undefined;
        }
        return parseGithubFullNameFromWorkspacePath(current.path.toString());
}

export function githubRepositoryToProjectExtracted(ctx: any, repo: QaapGithubRepositorySummary, pinnedIds: Set<string>, currentFullName?: string): MobileProjectEntry {
        const id = `github:${repo.fullName}`;
        const name = ctx.resolveDisplayName(id, repo.name);
        const isCurrent = repo.fullName.toLowerCase() === currentFullName;
        const lastActiveAt = isCurrent ? new Date().toISOString() : repo.updatedAt;
        const workspaceUri = isCurrent ? ctx.workspaceService.workspace?.resource : undefined;
        return {
            id,
            name,
            color: mobileProjectColorForName(repo.fullName),
            branch: repo.defaultBranch,
            status: isCurrent ? 'working' : 'idle',
            task: isCurrent
                ? nls.localize('qaap/mobileProjects/currentGithubTask', 'Open in this QAAP workspace')
                : repo.description?.trim()
                || (repo.private
                    ? nls.localize('qaap/mobileProjects/privateGithubRepo', 'Private GitHub repository')
                    : nls.localize('qaap/mobileProjects/githubRepo', 'GitHub repository')),
            progress: isCurrent ? 0.35 : 0,
            agents: isCurrent ? [{ role: 'ai', color: '#3B6FA0' }] : [],
            lastActive: isCurrent
                ? nls.localize('qaap/mobileProjects/lastActiveNow', 'now')
                : ctx.relativeUpdatedAt(repo.updatedAt),
            lastActiveAt,
            tokens: '—',
            cost: '—',
            pinned: ctx.isPinned(id, pinnedIds, isCurrent),
            uri: workspaceUri,
            github: {
                owner: repo.owner,
                name: repo.name,
                fullName: repo.fullName,
                htmlUrl: repo.htmlUrl,
                private: repo.private,
            },
            isCurrent,
        };
}

export function relativeUpdatedAtExtracted(ctx: any, value: string): string {
        const updated = Date.parse(value);
        if (!Number.isFinite(updated)) {
            return '—';
        }
        const diff = Math.max(0, Date.now() - updated);
        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;
        if (diff < hour) {
            return nls.localize('qaap/mobileProjects/updatedMinutes', '{0} min', String(Math.max(1, Math.round(diff / minute))));
        }
        if (diff < day) {
            return nls.localize('qaap/mobileProjects/updatedHours', '{0} h', String(Math.round(diff / hour)));
        }
        return nls.localize('qaap/mobileProjects/updatedDays', '{0} d', String(Math.round(diff / day)));
}

export function projectActivityTimeExtracted(ctx: any, project: MobileProjectEntry): number {
        if (!project.lastActiveAt) {
            return 0;
        }
        const time = Date.parse(project.lastActiveAt);
        return Number.isFinite(time) ? time : 0;
}

export function latestTimestampExtracted(ctx: any, a?: string, b?: string): string | undefined {
        const timeA = a ? Date.parse(a) : NaN;
        const timeB = b ? Date.parse(b) : NaN;
        if (Number.isFinite(timeA) && Number.isFinite(timeB)) {
            return timeA >= timeB ? a : b;
        }
        if (Number.isFinite(timeA)) {
            return a;
        }
        return Number.isFinite(timeB) ? b : undefined;
}

export function filterProjectsExtracted(ctx: any, projects: MobileProjectEntry[], filter: MobileProjectFilter): MobileProjectEntry[] {
        if (filter === 'active') {
            return projects.filter(p => p.status === 'working' || p.status === 'review');
        }
        if (filter === 'pinned') {
            return projects.filter(p => p.pinned);
        }
        return projects;
}

