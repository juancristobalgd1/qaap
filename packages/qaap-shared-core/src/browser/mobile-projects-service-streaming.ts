import type { MobileProjectsServiceContext } from './mobile-projects-service-context';
// Extracted from mobile-projects-service.ts

import URI from '@theia/core/lib/common/uri';
import { SingleTextInputDialog } from '@theia/core/lib/browser/dialogs';
import { nls } from '@theia/core/lib/common/nls';
import {
    deleteQaapGithubRepository,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type {
    QaapProjectSessionSummary,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    MobileProjectEntry,
    mobileProjectColorForName,
} from './mobile-projects-types';
import { isUserRepositoryFilesystemPath, isValidHubUserRepositoryProjectCandidate } from '../common/qaap-hub-project-eligibility';
import {
    readLocalProjectSessions,
    readLocalRemovedProjects,
    removeLocalProjectSession,
    setLocalProjectRemoved,
} from './mobile-projects-session-cache';
import { deduplicateMobileProjectEntries, withoutRemovedMobileProjects } from './mobile-projects-dedup';
import { QAAP_USER_REPOS_SEGMENT } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { parseUserRepositoryCloneFromWorkspacePath } from '../common/qaap-user-repository-clone-path';

export async function renameProjectExtracted(ctx: MobileProjectsServiceContext, project: MobileProjectEntry): Promise<boolean> {
        const dialog = new SingleTextInputDialog({
            title: nls.localize('qaap/mobileProjects/rename', 'Rename project'),
            initialValue: project.name,
            placeholder: nls.localize('qaap/mobileProjects/renamePlaceholder', 'Project name'),
            validate: (value, mode) => {
                if (mode !== 'preview' && !value.trim()) {
                    return nls.localize('qaap/mobileProjects/renameRequired', 'Enter a project name');
                }
                return true;
            },
        });
        const value = await dialog.open();
        const newName = value?.trim();
        if (!newName) {
            return false;
        }
        if (project.id.startsWith('custom:')) {
            const custom = ctx.readCustomProjects();
            const index = custom.findIndex(p => p.id === project.id);
            if (index < 0) {
                return false;
            }
            custom[index] = { ...custom[index], name: newName };
            ctx.writeCustomProjects(custom);
            return true;
        }
        const names = ctx.readDisplayNames();
        names[project.id] = newName;
        ctx.writeDisplayNames(names);
        return true;
}

export async function duplicateProjectExtracted(ctx: MobileProjectsServiceContext, project: MobileProjectEntry): Promise<boolean> {
        const custom = ctx.readCustomProjects();
        const allNames = [
            ...custom.map(p => p.name),
            ...(await ctx.loadProjects()).map(p => p.name),
        ];
        const copyName = ctx.uniqueCopyName(
            nls.localize('qaap/mobileProjects/copyOf', '{0} copy', project.name),
            allNames
        );
        const id = `custom:${Date.now()}`;
        const status = project.isCurrent ? 'idle' : project.status;
        custom.push({
            id,
            name: copyName,
            color: mobileProjectColorForName(copyName),
            branch: project.branch,
            status,
            task: project.task,
            progress: project.progress,
            agents: project.agents.map(a => ({ ...a })),
            lastActive: project.lastActive !== '—' ? project.lastActive : '—',
            lastActiveAt: project.lastActiveAt,
            tokens: project.tokens,
            cost: project.cost,
            pinned: false,
            uri: project.uri?.toString(),
        });
        ctx.writeCustomProjects(custom);
        return true;
}

export async function removeProjectExtracted(ctx: MobileProjectsServiceContext, project: MobileProjectEntry): Promise<boolean> {
        if (!ctx.canRemove(project)) {
            return false;
        }
        // A clone opened as a workspace is listed as a `recent:`/`ws:` card that shadows its
        // `github:` session (dedup prefers the workspace card), so the card has no `github`
        // field. Treat it as the clone it is: otherwise only the recent entry was forgotten,
        // the clone stayed on disk and the `github:` session brought the project straight back.
        // Custom projects are user-added folders: removing one never deletes anything on disk.
        const github = project.github
            ?? (project.id.startsWith('custom:') ? undefined : githubCloneOfProjectWorkspace(ctx, project));
        if (github) {
            await deleteQaapGithubRepository(github.owner, github.name);
            removeLocalProjectSession(`github:${github.fullName}`);
            setLocalProjectRemoved(`github:${github.fullName}`, true);
            const hiddenIds = ctx.readHiddenProjectIds();
            hiddenIds.add(project.id);
            hiddenIds.add(`github:${github.fullName}`);
            if (project.uri) {
                const key = project.uri.toString();
                hiddenIds.add(`recent:${key}`);
                removeLocalProjectSession(`ws:${key}`);
            }
            ctx.writeHiddenProjectIds(hiddenIds);
            if (project.uri) {
                await ctx.workspaceService.removeRecentWorkspace(project.uri.toString());
            }
            return true;
        }
        if (project.id.startsWith('custom:')) {
            const custom = ctx.readCustomProjects().filter(p => p.id !== project.id);
            ctx.writeCustomProjects(custom);
            const names = ctx.readDisplayNames();
            delete names[project.id];
            ctx.writeDisplayNames(names);
            const hiddenIds = ctx.readHiddenProjectIds();
            // A custom project can also be present in Theia's recent-workspace
            // list. Remove both representations so the card cannot immediately
            // reappear after the optimistic removal completes.
            hiddenIds.add(project.id);
            if (project.uri) {
                await ctx.workspaceService.removeRecentWorkspace(project.uri.toString());
                hiddenIds.add(`recent:${project.uri.toString()}`);
            }
            ctx.writeHiddenProjectIds(hiddenIds);
            return true;
        }
        if (project.uri) {
            // A clone listed from the recent-workspace catalog has no `github` metadata, but it is
            // still a server-side clone that counts against the plan's active-repo limit. Delete it
            // on the server too, otherwise "Remove" only hides it and the slot never frees.
            const clone = parseUserRepositoryCloneFromWorkspacePath(project.uri.path.toString());
            if (clone) {
                await deleteQaapGithubRepository(clone.owner, clone.name);
                removeLocalProjectSession(`github:${clone.owner}/${clone.name}`);
                setLocalProjectRemoved(`github:${clone.owner}/${clone.name}`, true);
            }
            await ctx.workspaceService.removeRecentWorkspace(project.uri.toString());
            // The recent-workspace service can briefly return a stale snapshot after removal.
            // Persisting the id as hidden makes the removal stable across immediate refreshes,
            // restarts, and every surface that consumes loadProjects/peekCachedProjects.
            const hiddenIds = ctx.readHiddenProjectIds();
            hiddenIds.add(project.id);
            ctx.writeHiddenProjectIds(hiddenIds);
            return true;
        }
        return false;
}

/**
 * `owner/repo` of a per-user clone when the card's folder IS the clone root
 * (`.../repos/users/{login}/{owner}/{repo}`). Sub-folders and other layouts return `undefined`:
 * removing such a card must never delete the whole repository.
 */
export function githubCloneOfProjectWorkspace(ctx: Pick<MobileProjectsServiceContext, 'cwdFromFileUri'>,
        project: MobileProjectEntry): { owner: string; name: string; fullName: string } | undefined {
        const cwd = project.uri ? ctx.cwdFromFileUri(project.uri) : undefined;
        if (!cwd) {
            return undefined;
        }
        const segments = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
        const reposIndex = segments.lastIndexOf('repos');
        const clone = reposIndex >= 0 ? segments.slice(reposIndex + 1) : [];
        if (clone.length !== 4 || clone[0] !== QAAP_USER_REPOS_SEGMENT) {
            return undefined;
        }
        const [, , owner, name] = clone;
        const segment = /^[A-Za-z0-9_.-]+$/;
        if (!segment.test(owner) || !segment.test(name) || /^\.+$/.test(owner) || /^\.+$/.test(name)) {
            return undefined;
        }
        return { owner, name, fullName: `${owner}/${name}` };
}

export function getCurrentWorkspaceDisplayNameExtracted(ctx: MobileProjectsServiceContext): string | undefined {
        const current = ctx.workspaceService.workspace;
        if (!current) {
            return undefined;
        }
        const uri = current.resource;
        const id = `ws:${uri.toString()}`;
        const name = ctx.labelProvider.getName(uri);
        return ctx.resolveDisplayName(id, name);
}

export function getCurrentWorkspaceBranchExtracted(ctx: MobileProjectsServiceContext): string | undefined {
        const repoKey = ctx.currentRepoKey();
        if (!repoKey) {
            return undefined;
        }
        return readLocalProjectSessions().get(repoKey)?.branch || 'main';
}

export function peekCachedProjectsExtracted(ctx: MobileProjectsServiceContext): MobileProjectEntry[] {
        const sessionMap = readLocalProjectSessions();
        const entries: MobileProjectEntry[] = [];
        const seen = new Set<string>();
        const hiddenIds = ctx.readHiddenProjectIds();
        const pinnedIds = ctx.readPinnedProjectIds();
        const current = ctx.workspaceService.workspace?.resource;

        for (const session of sessionMap.values()) {
            const entry = ctx.cachedSessionToEntry(session, pinnedIds, current);
            if (!entry || hiddenIds.has(entry.id) || seen.has(entry.id)) {
                continue;
            }
            seen.add(entry.id);
            entries.push(entry);
        }

        for (const stored of ctx.readCustomProjects()) {
            if (hiddenIds.has(stored.id) || seen.has(stored.id)) {
                continue;
            }
            const entry = ctx.storedToEntry(stored, pinnedIds);
            if (!ctx.isBrowsableHubProject(entry)) {
                continue;
            }
            seen.add(stored.id);
            entries.push(entry);
        }

        return ctx.overlayActiveTasks(ctx.sortProjectsByRecent(
            ctx.collapseCurrentWorkspaceDuplicates(
                withoutRemovedHubProjects(ctx, entries.filter(project => ctx.isBrowsableHubProject(project))),
            ),
        ));
}

/** A removed project stays off the hub whatever still names it: path-keyed rows, recent workspaces, the open workspace. */
function withoutRemovedHubProjects(ctx: MobileProjectsServiceContext, entries: readonly MobileProjectEntry[]): MobileProjectEntry[] {
        return withoutRemovedMobileProjects(entries, readLocalRemovedProjects(), uri => ctx.cwdFromFileUri(uri));
}

export function isBrowsableHubProjectExtracted(ctx: MobileProjectsServiceContext, project: MobileProjectEntry): boolean {
        return isValidHubUserRepositoryProjectCandidate({
            hasGithub: !!project.github,
            filesystemPath: ctx.cwdFromFileUri(project.uri),
        });
}

export function cachedSessionToEntryExtracted(ctx: MobileProjectsServiceContext, session: QaapProjectSessionSummary,
        pinnedIds: Set<string>,
        current: URI | undefined,): MobileProjectEntry | undefined {
        if (session.repoKey.startsWith('github:')) {
            return ctx.cachedGithubSessionToEntry(session, pinnedIds, current);
        }
        if (session.repoKey.startsWith('ws:')) {
            return ctx.cachedWorkspaceSessionToEntry(session, pinnedIds, current);
        }
        return undefined;
}

export function cachedGithubSessionToEntryExtracted(ctx: MobileProjectsServiceContext, session: QaapProjectSessionSummary,
        pinnedIds: Set<string>,
        current: URI | undefined,): MobileProjectEntry | undefined {
        const fullName = session.repoKey.slice('github:'.length);
        const [owner, name] = fullName.split('/');
        if (!owner || !name) {
            return undefined;
        }
        const currentFullName = ctx.currentGithubRepositoryFullName();
        const isCurrent = fullName.toLowerCase() === currentFullName;
        const entry: MobileProjectEntry = {
            id: session.repoKey,
            name: ctx.resolveDisplayName(session.repoKey, name),
            color: mobileProjectColorForName(fullName),
            branch: session.branch || 'main',
            status: session.agentState ?? (isCurrent ? 'working' : 'idle'),
            task: session.lastTask?.trim()
                || (isCurrent
                    ? nls.localize('qaap/mobileProjects/currentGithubTask', 'Open in this QAAP workspace')
                    : nls.localize('qaap/mobileProjects/githubRepo', 'GitHub repository')),
            progress: session.agentState === 'working' || isCurrent ? 0.35 : 0,
            agents: session.agentState === 'working' || session.agentState === 'review' || isCurrent
                ? [{ role: 'ai', color: '#3B6FA0' }]
                : [],
            lastActive: session.lastActiveAt ? ctx.relativeUpdatedAt(session.lastActiveAt) : '—',
            lastActiveAt: session.lastActiveAt,
            tokens: session.tokens ?? '—',
            cost: session.cost ?? '—',
            pinned: ctx.isPinned(session.repoKey, pinnedIds, isCurrent),
            // Prefer the server-derived clone path: `current` is the OPEN workspace, which on
            // hosted deployments is the multi-repo container — getProjectCwd rightly filters it,
            // which used to leave every hosted hub entry with no usable project path.
            uri: session.workspaceUri ? new URI(session.workspaceUri) : (isCurrent ? current : undefined),
            github: {
                owner,
                name,
                fullName,
                htmlUrl: `https://github.com/${fullName}`,
                private: false,
            },
            isCurrent,
            previewUrl: session.previewUrl,
        };
        return ctx.applySessionToEntry(entry, session);
}

export function cachedWorkspaceSessionToEntryExtracted(ctx: MobileProjectsServiceContext, session: QaapProjectSessionSummary,
        pinnedIds: Set<string>,
        current: URI | undefined,): MobileProjectEntry | undefined {
        const rawUri = session.repoKey.slice('ws:'.length);
        if (!rawUri) {
            return undefined;
        }
        const uri = new URI(rawUri);
        const isCurrent = current?.toString() === uri.toString();
        const name = ctx.labelProvider.getName(uri);
        const entry: MobileProjectEntry = {
            id: session.repoKey,
            name: ctx.resolveDisplayName(session.repoKey, name),
            color: mobileProjectColorForName(name),
            branch: session.branch || uri.path.base,
            status: session.agentState ?? (isCurrent ? 'working' : 'idle'),
            task: session.lastTask?.trim()
                || (isCurrent
                    ? nls.localize('qaap/mobileProjects/currentTask', 'Active workspace')
                    : nls.localize('qaap/mobileProjects/recentTask', 'Tap to open workspace')),
            progress: session.agentState === 'working' || isCurrent ? 0.35 : 0,
            agents: session.agentState === 'working' || session.agentState === 'review' || isCurrent
                ? [{ role: 'ai', color: '#3B6FA0' }]
                : [],
            lastActive: session.lastActiveAt ? ctx.relativeUpdatedAt(session.lastActiveAt) : '—',
            lastActiveAt: session.lastActiveAt,
            tokens: session.tokens ?? '—',
            cost: session.cost ?? '—',
            pinned: ctx.isPinned(session.repoKey, pinnedIds, isCurrent),
            uri,
            isCurrent,
            previewUrl: session.previewUrl,
        };
        return ctx.applySessionToEntry(entry, session);
}

export async function loadProjectsExtracted(ctx: MobileProjectsServiceContext): Promise<MobileProjectEntry[]> {
        // Open the SSE stream the first time projects are queried — the panel will subscribe to
        // tracker changes to live-update cards as VPS tasks start/finish.
        ctx.activeTasks.start();
        const sessionMap = await ctx.loadSessionMap();
        const entries: MobileProjectEntry[] = [];
        const seen = new Set<string>();
        const hiddenIds = ctx.readHiddenProjectIds();
        const pinnedIds = ctx.readPinnedProjectIds();
        let staleRecentChanged = false;

        const current = ctx.workspaceService.workspace;
        if (current) {
            const uri = current.resource;
            const id = `ws:${uri.toString()}`;
            const candidate: MobileProjectEntry = {
                id,
                name: ctx.resolveDisplayName(id, ctx.labelProvider.getName(uri)),
                color: mobileProjectColorForName(ctx.labelProvider.getName(uri)),
                branch: uri.path.base,
                status: 'working',
                task: nls.localize('qaap/mobileProjects/currentTask', 'Active workspace'),
                progress: 0.35,
                agents: [{ role: 'ai', color: '#3B6FA0' }],
                lastActive: nls.localize('qaap/mobileProjects/lastActiveNow', 'now'),
                lastActiveAt: new Date().toISOString(),
                tokens: '—',
                cost: '—',
                pinned: ctx.isPinned(id, pinnedIds, true),
                uri,
                isCurrent: true,
            };
            if (!seen.has(uri.toString()) && ctx.isBrowsableHubProject(candidate)) {
                entries.push(ctx.applySessionToEntry(candidate, sessionMap.get(id)));
                seen.add(uri.toString());
            }
        }

        try {
            const recent = await ctx.workspaceService.recentWorkspaces();
            for (const path of recent) {
                const uri = new URI(path);
                const key = uri.toString();
                if (seen.has(key)) {
                    continue;
                }
                const recentCwd = ctx.cwdFromFileUri(uri);
                if (recentCwd && isUserRepositoryFilesystemPath(recentCwd)
                    && ctx.fileService && !(await ctx.fileService.exists(uri))) {
                    await ctx.workspaceService.removeRecentWorkspace(key);
                    hiddenIds.add(`recent:${key}`);
                    staleRecentChanged = true;
                    continue;
                }
                const name = ctx.labelProvider.getName(uri);
                const id = `recent:${key}`;
                const candidate: MobileProjectEntry = {
                    id,
                    name: ctx.resolveDisplayName(id, name),
                    color: mobileProjectColorForName(name),
                    branch: uri.path.base,
                    status: 'idle',
                    task: nls.localize('qaap/mobileProjects/recentTask', 'Tap to open workspace'),
                    progress: 0,
                    agents: [],
                    lastActive: '—',
                    tokens: '—',
                    cost: '—',
                    pinned: ctx.isPinned(id, pinnedIds, false),
                    uri,
                    isCurrent: false,
                };
                if (!ctx.isBrowsableHubProject(candidate)) {
                    continue;
                }
                seen.add(key);
                entries.push(ctx.applySessionToEntry(candidate, sessionMap.get(`ws:${key}`)));
            }
            if (staleRecentChanged) {
                ctx.writeHiddenProjectIds(hiddenIds);
            }
        } catch {
            /* recent list optional */
        }

        for (const stored of ctx.readCustomProjects()) {
            if (hiddenIds.has(stored.id) || entries.some(e => e.id === stored.id)) {
                continue;
            }
            if (stored.uri && seen.has(stored.uri)) {
                continue;
            }
            if (stored.uri) {
                seen.add(stored.uri);
            }
            const entry = ctx.storedToEntry(stored, pinnedIds);
            if (!ctx.isBrowsableHubProject(entry)) {
                continue;
            }
            entries.push(entry);
        }

        // Skip-auth and public clones never appear in `/github/repositories`. Surface every
        // github: session that already has an on-disk workspace so the hub lists cloned repos.
        const currentUri = current?.resource;
        for (const session of sessionMap.values()) {
            if (!session.repoKey.startsWith('github:')) {
                continue;
            }
            const entry = ctx.cachedGithubSessionToEntry(session, pinnedIds, currentUri);
            if (!entry || hiddenIds.has(entry.id) || entries.some(e => e.id === entry.id)) {
                continue;
            }
            const uriKey = entry.uri?.toString();
            if (uriKey && seen.has(uriKey)) {
                continue;
            }
            if (!ctx.isBrowsableHubProject(entry)) {
                continue;
            }
            if (uriKey) {
                seen.add(uriKey);
            }
            entries.push(entry);
        }

        // Only GitHub repos already opened/cloned into Qaap (sessions + current), not the full
        // remote catalog — Work Hub / sidebar are "projects in the app", not a GitHub browser.
        // Full catalog remains available via {@link listGithubRepositories} (Open repository dialog).
        const githubProjects = await ctx.loadGithubProjects(sessionMap, false);
        for (const project of githubProjects) {
            if (hiddenIds.has(project.id) || entries.some(entry => entry.id === project.id)) {
                continue;
            }
            const uriKey = project.uri?.toString();
            if (uriKey && seen.has(uriKey)) {
                continue;
            }
            if (uriKey) {
                seen.add(uriKey);
            }
            entries.push(project);
        }

        return ctx.overlayActiveTasks(ctx.sortProjectsByRecent(
            ctx.collapseCurrentWorkspaceDuplicates(
                withoutRemovedHubProjects(ctx, entries.filter(project => ctx.isBrowsableHubProject(project))),
            ).filter(p => !hiddenIds.has(p.id)),
        ));
}

export function collapseCurrentWorkspaceDuplicatesExtracted(ctx: MobileProjectsServiceContext, entries: MobileProjectEntry[]): MobileProjectEntry[] {
        return deduplicateMobileProjectEntries(entries, {
            normalizeName: name => ctx.normalizeProjectName(name),
            cwdFromUri: uri => ctx.cwdFromFileUri(uri),
            projectActivityTime: project => ctx.projectActivityTime(project),
        });
}

export function overlayActiveTasksExtracted(ctx: MobileProjectsServiceContext, projects: MobileProjectEntry[]): MobileProjectEntry[] {
        return projects.map(project => {
            const cwd = ctx.cwdForProject(project);
            if (!cwd) {
                return project;
            }
            const info = ctx.activeTasks.getForCwd(cwd);
            if (!info) {
                return project;
            }
            return {
                ...project,
                status: 'working',
                task: info.title ?? project.task,
                lastActive: nls.localize('qaap/mobileProjects/lastActiveNow', 'now'),
            };
        });
}

export function getProjectCwdExtracted(ctx: MobileProjectsServiceContext, project: MobileProjectEntry): string | undefined {
        const fromUri = ctx.cwdFromFileUri(project.uri);
        if (fromUri) {
            return fromUri;
        }
        if (project.isCurrent && ctx.workspaceService.workspace) {
            return ctx.cwdFromFileUri(ctx.workspaceService.workspace.resource);
        }
        return undefined;
}

