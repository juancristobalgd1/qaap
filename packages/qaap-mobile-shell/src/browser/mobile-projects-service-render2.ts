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
import { CUSTOM_PROJECTS_STORAGE_KEY, DISPLAY_NAMES_STORAGE_KEY, HIDDEN_PROJECT_IDS_STORAGE_KEY, PINNED_PROJECT_IDS_STORAGE_KEY } from './mobile-projects-service';

function clearHiddenProjectIdExtracted(ctx: any, id: string): void {
        const hiddenIds = ctx.readHiddenProjectIds();
        if (hiddenIds.delete(id)) {
            ctx.writeHiddenProjectIds(hiddenIds);
        }
}

export function readHiddenProjectIdsExtracted(ctx: any): Set<string> {
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

export function writeHiddenProjectIdsExtracted(ctx: any, ids: Set<string>): void {
        if (typeof localStorage === 'undefined') {
            return;
        }
        localStorage.setItem(mobileProjectsUserStorageKey(HIDDEN_PROJECT_IDS_STORAGE_KEY), JSON.stringify([...ids]));
}

export function readPinnedProjectIdsExtracted(ctx: any): Set<string> {
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

export function writePinnedProjectIdsExtracted(ctx: any, ids: Set<string>): void {
        if (typeof localStorage === 'undefined') {
            return;
        }
        localStorage.setItem(mobileProjectsUserStorageKey(PINNED_PROJECT_IDS_STORAGE_KEY), JSON.stringify([...ids]));
}

export function isPinnedExtracted(ctx: any, id: string, pinnedIds: Set<string>, defaultPinned: boolean): boolean {
        if (pinnedIds.has(id)) {
            return true;
        }
        if (pinnedIds.has(`!${id}`)) {
            return false;
        }
        return defaultPinned;
}

export function togglePinExtracted(ctx: any, project: MobileProjectEntry): boolean {
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

export function workspacePathFromUriExtracted(ctx: any, uri: URI): string {
        return uri.authority
            ? `//${uri.authority}${uri.path.toString()}`
            : uri.path.toString();
}

export function openWorkspaceUriExtracted(ctx: any, uri: URI): void {
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

export function formatRepositoryLabelExtracted(ctx: any, repository: string): string {
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

export async function openInCurrentWindowAsyncExtracted(ctx: any, project: MobileProjectEntry): Promise<void> {
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

export function openInNewWindowExtracted(ctx: any, project: MobileProjectEntry): void {
        if (project.github) {
            void ctx.openGithubProject(project, true);
            return;
        }
        if (!project.uri) {
            return;
        }
        ctx.touchProjectActivity(project);
        markMobileProjectReadmeForOpen();
        const url = new URL(window.location.href);
        url.hash = encodeURI(ctx.workspacePathFromUri(project.uri));
        ctx.windowService.openNewWindow(url.toString());
}

export async function openGithubProjectExtracted(ctx: any, project: MobileProjectEntry, newWindow = false): Promise<void> {
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

export async function createGithubProjectExtracted(ctx: any): Promise<MobileProjectEntry[] | undefined> {
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
            ctx.registerGithubWorkspaceProject(result.repository, new URI(result.workspaceUri));
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

export async function cloneGithubProjectExtracted(ctx: any): Promise<MobileProjectEntry[] | undefined> {
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

export async function cloneGithubProjectByRepositoryExtracted(ctx: any, repository: string): Promise<MobileProjectEntry[] | undefined> {
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
            ctx.registerGithubWorkspaceProject(result.repository, new URI(result.workspaceUri));
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

export function readDisplayNamesExtracted(ctx: any): Record<string, string> {
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

export function writeDisplayNamesExtracted(ctx: any, names: Record<string, string>): void {
        if (typeof localStorage === 'undefined') {
            return;
        }
        localStorage.setItem(mobileProjectsUserStorageKey(DISPLAY_NAMES_STORAGE_KEY), JSON.stringify(names));
}

export function readCustomProjectsExtracted(ctx: any): StoredMobileProject[] {
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

export function writeCustomProjectsExtracted(ctx: any, projects: StoredMobileProject[]): void {
        if (typeof localStorage === 'undefined') {
            return;
        }
        localStorage.setItem(mobileProjectsUserStorageKey(CUSTOM_PROJECTS_STORAGE_KEY), JSON.stringify(projects));
}

export async function importGithubProjectExtracted(ctx: any, project: MobileProjectEntry): Promise<MobileProjectEntry[] | undefined> {
        if (!project.github) {
            return undefined;
        }
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/importingRepo', 'Importing {0}…', project.github.fullName),
            { kind: 'loading' }
        );
        try {
            const result = await openQaapGithubRepository(project.github.owner, project.github.name);
            ctx.registerGithubWorkspaceProject(result.repository, new URI(result.workspaceUri));
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

export function registerGithubWorkspaceProjectExtracted(ctx: any, repository: QaapGithubRepositorySummary, uri: URI): void {
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

export function storedToEntryExtracted(ctx: any, stored: StoredMobileProject, pinnedIds: Set<string>): MobileProjectEntry {
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

export function uniqueCopyNameExtracted(ctx: any, base: string, existingNames: string[]): string {
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

