import type { MobileProjectsServiceContext } from './mobile-projects-service-context';
// Extracted from mobile-projects-service.ts

import URI from '@theia/core/lib/common/uri';
import { SingleTextInputDialog } from '@theia/core/lib/browser/dialogs';
import { nls } from '@theia/core/lib/common/nls';
import {
    cloneQaapGithubRepository,
    createQaapGithubRepository,
    openQaapGithubRepository,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type { QaapGithubRepositorySummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    MobileProjectEntry,
    mobileProjectColorForName,
    StoredMobileProject,
} from './mobile-projects-types';
import {
    clearMobileProjectReadmeOpenRequest,
    markMobileProjectReadmeForOpen,
    markMobileProjectsPanelDismiss,
    requestMobileProjectsPanelDismiss,
} from './mobile-projects-open';
import { MobileSnackbar } from './mobile-snackbar';
import {
    mobileProjectsUserStorageKey,
} from './mobile-projects-user-storage';
import { CUSTOM_PROJECTS_STORAGE_KEY, DISPLAY_NAMES_STORAGE_KEY, HIDDEN_PROJECT_IDS_STORAGE_KEY, PINNED_PROJECT_IDS_STORAGE_KEY } from './mobile-projects-service';

function clearHiddenProjectIdExtracted(ctx: MobileProjectsServiceContext, id: string): void {
        const hiddenIds = ctx.readHiddenProjectIds();
        if (hiddenIds.delete(id)) {
            ctx.writeHiddenProjectIds(hiddenIds);
        }
}

export function readHiddenProjectIdsExtracted(ctx: MobileProjectsServiceContext): Set<string> {
        if (typeof localStorage === 'undefined') {
            return new Set();
        }
        try {
            const raw = localStorage.getItem(mobileProjectsUserStorageKey(HIDDEN_PROJECT_IDS_STORAGE_KEY));
            if (!raw) {
                return new Set();
            }
            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed)) {
                return new Set();
            }
            return new Set(parsed.filter((id): id is string => typeof id === 'string'));
        } catch {
            return new Set();
        }
}

export function writeHiddenProjectIdsExtracted(ctx: MobileProjectsServiceContext, ids: Set<string>): void {
        if (typeof localStorage === 'undefined') {
            return;
        }
        localStorage.setItem(mobileProjectsUserStorageKey(HIDDEN_PROJECT_IDS_STORAGE_KEY), JSON.stringify([...ids]));
}

export function readPinnedProjectIdsExtracted(ctx: MobileProjectsServiceContext): Set<string> {
        if (typeof localStorage === 'undefined') {
            return new Set();
        }
        try {
            const raw = localStorage.getItem(mobileProjectsUserStorageKey(PINNED_PROJECT_IDS_STORAGE_KEY));
            if (!raw) {
                return new Set();
            }
            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed)) {
                return new Set();
            }
            return new Set(parsed.filter((id): id is string => typeof id === 'string'));
        } catch {
            return new Set();
        }
}

export function writePinnedProjectIdsExtracted(ctx: MobileProjectsServiceContext, ids: Set<string>): void {
        if (typeof localStorage === 'undefined') {
            return;
        }
        localStorage.setItem(mobileProjectsUserStorageKey(PINNED_PROJECT_IDS_STORAGE_KEY), JSON.stringify([...ids]));
}

export function isPinnedExtracted(ctx: MobileProjectsServiceContext, id: string, pinnedIds: Set<string>, defaultPinned: boolean): boolean {
        if (pinnedIds.has(id)) {
            return true;
        }
        if (pinnedIds.has(`!${id}`)) {
            return false;
        }
        return defaultPinned;
}

export function togglePinExtracted(ctx: MobileProjectsServiceContext, project: MobileProjectEntry): boolean {
        const pinnedIds = ctx.readPinnedProjectIds();
        const nextPinned = !project.pinned;
        pinnedIds.delete(project.id);
        pinnedIds.delete(`!${project.id}`);
        if (nextPinned) {
            pinnedIds.add(project.id);
        } else {
            pinnedIds.add(`!${project.id}`);
        }
        ctx.writePinnedProjectIds(pinnedIds);
        return nextPinned;
}

export function workspacePathFromUriExtracted(ctx: MobileProjectsServiceContext, uri: URI): string {
        return uri.authority
            ? `//${uri.authority}${uri.path.toString()}`
            : uri.path.toString();
}

export function openWorkspaceUriExtracted(ctx: MobileProjectsServiceContext, uri: URI): void {
        const hiddenIds = ctx.readHiddenProjectIds();
        const recentId = `recent:${uri.toString()}`;
        if (hiddenIds.delete(recentId)) {
            ctx.writeHiddenProjectIds(hiddenIds);
        }
        ctx.touchWorkspaceActivity(uri);
        requestMobileProjectsPanelDismiss();
        markMobileProjectReadmeForOpen();
        ctx.workspaceService.open(uri, { preserveWindow: true });
}

export function formatRepositoryLabelExtracted(ctx: MobileProjectsServiceContext, repository: string): string {
        const trimmed = repository.trim().replace(/\.git$/, '');
        try {
            const url = new URL(trimmed);
            if (url.hostname.toLowerCase() === 'github.com') {
                const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
                if (segments.length >= 2) {
                    return `${segments[0]}/${segments[1]}`;
                }
            }
        } catch {
            /* owner/repo */
        }
        return trimmed;
}

export async function openInCurrentWindowAsyncExtracted(ctx: MobileProjectsServiceContext, project: MobileProjectEntry): Promise<void> {
        markMobileProjectsPanelDismiss();
        if (project.github) {
            await ctx.openGithubProject(project);
            return;
        }
        if (project.uri) {
            ctx.touchProjectActivity(project);
            ctx.openWorkspaceUri(project.uri);
        }
}

export async function openGithubProjectExtracted(ctx: MobileProjectsServiceContext, project: MobileProjectEntry, newWindow = false): Promise<void> {
        if (!project.github) {
            return;
        }
        markMobileProjectReadmeForOpen();
        const label = project.github.fullName;
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/openingRepo', 'Opening {0}…', label),
            { kind: 'loading' }
        );
        try {
            const result = await openQaapGithubRepository(project.github.owner, project.github.name);
            const uri = new URI(result.workspaceUri);
            clearHiddenProjectIdExtracted(ctx, `github:${result.repository.fullName}`);
            ctx.touchGithubRepositoryActivity(result.repository);
            if (newWindow) {
                MobileSnackbar.dismiss();
                const url = new URL(window.location.href);
                url.hash = encodeURI(ctx.workspacePathFromUri(uri));
                ctx.windowService.openNewWindow(url.toString());
                return;
            }
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/repoOpened', 'Opened {0}', result.repository.fullName),
                { kind: 'success', duration: 2400 }
            );
            ctx.openWorkspaceUri(uri);
        } catch (err) {
            MobileSnackbar.dismiss();
            // Without this, the backend error (e.g. failed clone, missing workspace root) is silently
            // dropped on the floor and the user sees the project tap as a no-op.
            clearMobileProjectReadmeOpenRequest();
            const detail = err instanceof Error ? err.message : String(err);
            await ctx.messageService.error(
                nls.localize(
                    'qaap/mobileProjects/openGithubFailed',
                    'Could not open {0}: {1}',
                    project.github.fullName,
                    detail
                )
            );
        }
}

export async function createGithubProjectExtracted(ctx: MobileProjectsServiceContext): Promise<MobileProjectEntry[] | undefined> {
        const dialog = new SingleTextInputDialog({
            title: nls.localize('qaap/mobileProjects/createGithubRepo', 'Create GitHub repository'),
            placeholder: nls.localize('qaap/mobileProjects/createGithubRepoPlaceholder', 'repository-name'),
            validate: (value, mode) => {
                const name = value.trim();
                if (mode !== 'preview' && !name) {
                    return nls.localize('qaap/mobileProjects/createGithubRepoRequired', 'Enter a repository name');
                }
                if (name && (!/^[A-Za-z0-9_.-]+$/.test(name) || name.startsWith('.'))) {
                    return nls.localize('qaap/mobileProjects/createGithubRepoInvalid', 'Use letters, numbers, dashes, underscores, or dots');
                }
                return true;
            },
        });
        const name = (await dialog.open())?.trim();
        if (!name) {
            return undefined;
        }
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/creatingRepo', 'Creating {0}…', name),
            { kind: 'loading' }
        );
        try {
            const result = await createQaapGithubRepository({ name, private: true });
            const workspaceUri = new URI(result.workspaceUri);
            ctx.registerGithubWorkspaceProject(result.repository, workspaceUri);
            ctx.openWorkspaceUri(workspaceUri);
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/repoCreated', 'Created {0}', result.repository.fullName),
                { kind: 'success', duration: 2400 }
            );
            return ctx.loadProjects();
        } catch (err) {
            MobileSnackbar.dismiss();
            await ctx.messageService.error(err instanceof Error ? err.message : String(err));
            return undefined;
        }
}

export async function cloneGithubProjectExtracted(ctx: MobileProjectsServiceContext): Promise<MobileProjectEntry[] | undefined> {
        const dialog = new SingleTextInputDialog({
            title: nls.localize('qaap/mobileProjects/cloneGithubRepo', 'Clone GitHub repository'),
            placeholder: nls.localize('qaap/mobileProjects/cloneGithubRepoPlaceholder', 'owner/repo or https://github.com/owner/repo'),
            validate: (value, mode) => {
                if (mode !== 'preview' && !value.trim()) {
                    return nls.localize('qaap/mobileProjects/cloneGithubRepoRequired', 'Enter a GitHub repository');
                }
                return true;
            },
        });
        const repository = (await dialog.open())?.trim();
        if (!repository) {
            return undefined;
        }
        return ctx.cloneGithubProjectByRepository(repository);
}

export async function cloneGithubProjectByRepositoryExtracted(ctx: MobileProjectsServiceContext, repository: string): Promise<MobileProjectEntry[] | undefined> {
        const trimmed = repository.trim();
        if (!trimmed) {
            return undefined;
        }
        const label = ctx.formatRepositoryLabel(trimmed);
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/cloningRepo', 'Cloning {0}…', label),
            { kind: 'loading' }
        );
        try {
            const result = await cloneQaapGithubRepository(trimmed);
            const workspaceUri = new URI(result.workspaceUri);
            ctx.registerGithubWorkspaceProject(result.repository, workspaceUri);
            ctx.openWorkspaceUri(workspaceUri);
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/repoCloned', 'Cloned {0}', result.repository.fullName),
                { kind: 'success', duration: 2400 }
            );
            return ctx.loadProjects();
        } catch (err) {
            MobileSnackbar.dismiss();
            await ctx.messageService.error(err instanceof Error ? err.message : String(err));
            return undefined;
        }
}

export function readDisplayNamesExtracted(ctx: MobileProjectsServiceContext): Record<string, string> {
        if (typeof localStorage === 'undefined') {
            return {};
        }
        try {
            const raw = localStorage.getItem(mobileProjectsUserStorageKey(DISPLAY_NAMES_STORAGE_KEY));
            if (!raw) {
                return {};
            }
            const parsed = JSON.parse(raw) as unknown;
            if (!parsed || typeof parsed !== 'object') {
                return {};
            }
            return parsed as Record<string, string>;
        } catch {
            return {};
        }
}

export function writeDisplayNamesExtracted(ctx: MobileProjectsServiceContext, names: Record<string, string>): void {
        if (typeof localStorage === 'undefined') {
            return;
        }
        localStorage.setItem(mobileProjectsUserStorageKey(DISPLAY_NAMES_STORAGE_KEY), JSON.stringify(names));
}

export function readCustomProjectsExtracted(ctx: MobileProjectsServiceContext): StoredMobileProject[] {
        if (typeof localStorage === 'undefined') {
            return [];
        }
        try {
            const raw = localStorage.getItem(mobileProjectsUserStorageKey(CUSTOM_PROJECTS_STORAGE_KEY));
            if (!raw) {
                return [];
            }
            const parsed = JSON.parse(raw) as unknown;
            return Array.isArray(parsed) ? parsed as StoredMobileProject[] : [];
        } catch {
            return [];
        }
}

export function writeCustomProjectsExtracted(ctx: MobileProjectsServiceContext, projects: StoredMobileProject[]): void {
        if (typeof localStorage === 'undefined') {
            return;
        }
        localStorage.setItem(mobileProjectsUserStorageKey(CUSTOM_PROJECTS_STORAGE_KEY), JSON.stringify(projects));
}

export async function importGithubProjectExtracted(ctx: MobileProjectsServiceContext, project: MobileProjectEntry): Promise<MobileProjectEntry[] | undefined> {
        if (!project.github) {
            return undefined;
        }
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/importingRepo', 'Importing {0}…', project.github.fullName),
            { kind: 'loading' }
        );
        try {
            const result = await openQaapGithubRepository(project.github.owner, project.github.name);
            const workspaceUri = new URI(result.workspaceUri);
            ctx.registerGithubWorkspaceProject(result.repository, workspaceUri);
            ctx.openWorkspaceUri(workspaceUri);
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/repoImported', 'Imported {0}', result.repository.fullName),
                { kind: 'success', duration: 2400 }
            );
            return ctx.loadProjects();
        } catch (err) {
            MobileSnackbar.dismiss();
            await ctx.messageService.error(err instanceof Error ? err.message : String(err));
            return undefined;
        }
}

export function registerGithubWorkspaceProjectExtracted(ctx: MobileProjectsServiceContext, repository: QaapGithubRepositorySummary, uri: URI): void {
        clearHiddenProjectIdExtracted(ctx, `github:${repository.fullName}`);
        ctx.touchGithubRepositoryActivity(repository);
        const custom = ctx.readCustomProjects();
        const id = `custom:${uri.toString()}`;
        const existing = custom.findIndex(project => project.id === id || project.uri === uri.toString());
        const entry: StoredMobileProject = {
            id,
            name: repository.name,
            color: mobileProjectColorForName(repository.fullName),
            branch: repository.defaultBranch,
            status: 'idle',
            task: nls.localize('qaap/mobileProjects/recentTask', 'Tap to open workspace'),
            progress: 0,
            agents: [],
            lastActive: ctx.relativeUpdatedAt(new Date().toISOString()),
            lastActiveAt: new Date().toISOString(),
            tokens: '—',
            cost: '—',
            pinned: false,
            uri: uri.toString(),
        };
        if (existing >= 0) {
            custom[existing] = { ...custom[existing], ...entry, pinned: custom[existing].pinned };
        } else {
            custom.push(entry);
        }
        ctx.writeCustomProjects(custom);
        // If the repo was previously hidden (same workspace URI/id), unhide it so create/import
        // actions always surface it immediately in Work Hub.
        const hiddenIds = ctx.readHiddenProjectIds();
        if (hiddenIds.delete(id)) {
            ctx.writeHiddenProjectIds(hiddenIds);
        }
}

export function storedToEntryExtracted(ctx: MobileProjectsServiceContext, stored: StoredMobileProject, pinnedIds: Set<string>): MobileProjectEntry {
        return {
            id: stored.id,
            name: stored.name,
            color: stored.color,
            branch: stored.branch,
            status: stored.status,
            task: stored.task,
            progress: stored.progress,
            agents: stored.agents,
            lastActive: stored.lastActive,
            lastActiveAt: stored.lastActiveAt,
            tokens: stored.tokens,
            cost: stored.cost,
            pinned: ctx.isPinned(stored.id, pinnedIds, stored.pinned),
            uri: stored.uri ? new URI(stored.uri) : undefined,
            isCurrent: false,
        };
}

export function uniqueCopyNameExtracted(ctx: MobileProjectsServiceContext, base: string, existingNames: string[]): string {
        const trimmed = base.trim() || nls.localize('qaap/mobileProjects/untitled', 'Project');
        if (!existingNames.includes(trimmed)) {
            return trimmed;
        }
        let i = 2;
        while (existingNames.includes(`${trimmed} (${i})`)) {
            i++;
        }
        return `${trimmed} (${i})`;
}

