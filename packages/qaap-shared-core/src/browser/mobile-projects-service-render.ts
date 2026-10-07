import type { MobileProjectsServiceContext } from './mobile-projects-service-context';
// Extracted from mobile-projects-service.ts

import URI from '@theia/core/lib/common/uri';
import { SingleTextInputDialog } from '@theia/core/lib/browser/dialogs';
import { nls } from '@theia/core/lib/common/nls';
import {
    createQaapGithubRepository,
    openQaapGithubRepository,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type { QaapGithubOpenRepositoryResponse, QaapGithubRepositorySummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    formatRepositoryImportStatus,
    QaapRepositoryImport,
    QaapRepositoryImportError,
} from './qaap-repository-import-tracker';
import {
    MobileProjectEntry,
    mobileProjectColorForName,
    StoredMobileProject,
} from './mobile-projects-types';
import {
    clearMobileProjectReadmeOpenRequest,
    clearMobileProjectsPanelDismiss,
    markMobileProjectReadmeForOpen,
    markMobileProjectsPanelDismiss,
    requestMobileProjectsPanelDismiss,
    requestMobileProjectsPanelRestore,
} from './mobile-projects-open';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';
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

/** Upper bound for the pre-open existence check of the workspace root. */
const OPEN_WORKSPACE_RESOLVE_TIMEOUT_MS = 20_000;
/** `workspaceService.open` reloads the page; if we are still alive after this, the open silently failed. */
const OPEN_WORKSPACE_RELOAD_WATCHDOG_MS = 20_000;

async function resolveWorkspaceRootExtracted(ctx: MobileProjectsServiceContext, uri: URI): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(nls.localize(
                'qaap/mobileProjects/openWorkspaceResolveTimedOut',
                'The workspace folder did not respond in time.'
            ))), OPEN_WORKSPACE_RESOLVE_TIMEOUT_MS);
        });
        try {
            await Promise.race([ctx.fileService.resolve(uri), timeout]);
        } finally {
            clearTimeout(timer);
        }
}

/**
 * Fire `onNoReload` if the page is still alive {@link OPEN_WORKSPACE_RELOAD_WATCHDOG_MS} after the
 * open. `pagehide` means the reload is committing, so the watchdog is cancelled instead of flashing
 * an error and the restored panel right before the reload. `beforeunload` switches to the longer
 * `navigationGraceMs`: navigation has started, and `pagehide` only fires once the new page starts
 * arriving, which a cold tenant backend can delay well past `timeoutMs`. A vetoed navigation
 * (dirty-editor prompt) still reports once that longer grace elapses.
 */
export function armWorkspaceReloadWatchdog(
    onNoReload: () => void,
    timeoutMs = OPEN_WORKSPACE_RELOAD_WATCHDOG_MS,
    navigationGraceMs = 3 * timeoutMs,
): () => void {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const arm = (delayMs: number): void => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                cancel();
                onNoReload();
            }, delayMs);
        };
        const onBeforeUnload = (): void => arm(navigationGraceMs);
        const cancel = (): void => {
            clearTimeout(timer);
            window.removeEventListener('beforeunload', onBeforeUnload);
            window.removeEventListener('pagehide', cancel);
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        window.addEventListener('pagehide', cancel);
        arm(timeoutMs);
        return cancel;
}

function failWorkspaceOpenExtracted(ctx: MobileProjectsServiceContext, uri: URI, detail: string, panelDismissed = false): void {
        MobileSnackbar.dismiss();
        clearMobileProjectReadmeOpenRequest();
        if (panelDismissed) {
            // The Work Hub already left the Projects panel; bring it back so the error has context.
            requestMobileProjectsPanelRestore();
        } else {
            clearMobileProjectsPanelDismiss();
        }
        void ctx.messageService.error(nls.localize(
            'qaap/mobileProjects/openWorkspaceFailed',
            'Could not open {0}: {1}',
            ctx.workspacePathFromUri(uri),
            detail
        ));
}

/**
 * Open `uri` as the workspace of this window. Resolves `true` once the (reloading) open was
 * issued, `false` when the workspace root could not be reached; the error is already surfaced.
 */
export async function openWorkspaceUriExtracted(ctx: MobileProjectsServiceContext, uri: URI): Promise<boolean> {
        // `WorkspaceService.open` is fire-and-forget and swallows an unreachable root, which left
        // the loading snackbar spinning forever. Check the root first so failures are visible.
        try {
            await resolveWorkspaceRootExtracted(ctx, uri);
        } catch (err) {
            failWorkspaceOpenExtracted(ctx, uri, err instanceof Error ? err.message : String(err));
            return false;
        }
        const hiddenIds = ctx.readHiddenProjectIds();
        const recentId = `recent:${uri.toString()}`;
        if (hiddenIds.delete(recentId)) {
            ctx.writeHiddenProjectIds(hiddenIds);
        }
        ctx.touchWorkspaceActivity(uri);
        requestMobileProjectsPanelDismiss();
        markMobileProjectReadmeForOpen();
        ctx.workspaceService.open(uri, { preserveWindow: true });
        armWorkspaceReloadWatchdog(() => failWorkspaceOpenExtracted(ctx, uri, nls.localize(
            'qaap/mobileProjects/openWorkspaceNoReload',
            'the workspace did not load. Please try again.'
        ), true));
        return true;
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

export async function openInCurrentWindowAsyncExtracted(ctx: MobileProjectsServiceContext, project: MobileProjectEntry): Promise<boolean> {
        markMobileProjectsPanelDismiss();
        if (project.github) {
            return ctx.openGithubProject(project);
        }
        if (project.uri) {
            ctx.touchProjectActivity(project);
            return ctx.openWorkspaceUri(project.uri);
        }
        return false;
}

export async function openGithubProjectExtracted(ctx: MobileProjectsServiceContext, project: MobileProjectEntry, newWindow = false): Promise<boolean> {
        if (!project.github) {
            return false;
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
                return false;
            }
            if (!await ctx.openWorkspaceUri(uri)) {
                return false;
            }
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/repoOpened', 'Opened {0}', result.repository.fullName),
                { kind: 'success', duration: 2400 }
            );
            return true;
        } catch (err) {
            MobileSnackbar.dismiss();
            // Without this, the backend error (e.g. failed clone, missing workspace root) is silently
            // dropped on the floor and the user sees the project tap as a no-op.
            clearMobileProjectReadmeOpenRequest();
            // No reload follows, so a later F5 must not skip the Projects landing.
            clearMobileProjectsPanelDismiss();
            const detail = err instanceof Error ? err.message : String(err);
            await ctx.messageService.error(
                nls.localize(
                    'qaap/mobileProjects/openGithubFailed',
                    'Could not open {0}: {1}',
                    project.github.fullName,
                    detail
                )
            );
            return false;
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
            if (!await ctx.openWorkspaceUri(workspaceUri)) {
                return ctx.loadProjects();
            }
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
        const repositoryImport = ctx.repositoryImports.start({ kind: 'clone', repository: trimmed }, ctx.formatRepositoryLabel(trimmed));
        return runRepositoryImportWithSnackbarExtracted(ctx, repositoryImport);
}

/**
 * Follow an import in the snackbar (phase + percent) and open the workspace when it succeeds.
 * Used by flows without their own progress UI (text-input clone dialog, project list import).
 */
export async function runRepositoryImportWithSnackbarExtracted(
    ctx: MobileProjectsServiceContext,
    repositoryImport: QaapRepositoryImport,
): Promise<MobileProjectEntry[] | undefined> {
        const render = (): void => {
            if (repositoryImport.running) {
                MobileSnackbar.show(`${repositoryImport.job.label}: ${formatRepositoryImportStatus(repositoryImport.job)}`, { kind: 'loading' });
            }
        };
        render();
        const listener = repositoryImport.onDidChange(render);
        try {
            const result = await repositoryImport.result;
            listener.dispose();
            return await ctx.finishGithubRepositoryImport(result, true);
        } catch (err) {
            listener.dispose();
            MobileSnackbar.dismiss();
            if (err instanceof QaapRepositoryImportError && err.cancelled) {
                return undefined;
            }
            await ctx.messageService.error(err instanceof Error ? err.message : String(err));
            return undefined;
        }
}

/**
 * Register a finished import as a Work Hub project. With `open`, switch the IDE to it (this reloads
 * the page); otherwise the project only appears in the list so a closed dialog never yanks the user
 * out of what they are doing.
 */
export async function finishGithubRepositoryImportExtracted(
    ctx: MobileProjectsServiceContext,
    result: QaapGithubOpenRepositoryResponse,
    open: boolean,
): Promise<MobileProjectEntry[] | undefined> {
        const workspaceUri = new URI(result.workspaceUri);
        ctx.registerGithubWorkspaceProject(result.repository, workspaceUri);
        if (open) {
            if (!await ctx.openWorkspaceUri(workspaceUri)) {
                return ctx.loadProjects();
            }
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/repoReady', 'Opening {0}', result.repository.fullName),
                { kind: 'success', duration: 2400 }
            );
        }
        return ctx.loadProjects();
}

/**
 * Keep reporting an import whose dialog was closed: progress in the snackbar (with Cancel), then
 * the project appears in the list and the user may open it from the success toast.
 */
export function watchGithubRepositoryImportInBackgroundExtracted(
    ctx: MobileProjectsServiceContext,
    repositoryImport: QaapRepositoryImport,
    onProjectsChanged?: (next: MobileProjectEntry[]) => void,
): void {
        repositoryImport.presenter = 'background';
        if (repositoryImport.backgroundWatched) {
            return;
        }
        repositoryImport.backgroundWatched = true;
        const render = (): void => {
            // The dialog was reopened and took the import back.
            if (!repositoryImport.running || repositoryImport.presenter !== 'background') {
                return;
            }
            MobileSnackbar.show(`${repositoryImport.job.label}: ${formatRepositoryImportStatus(repositoryImport.job)}`, {
                kind: 'loading',
                actionLabel: nls.localize('qaap/repositoryImport/cancelAction', 'Cancel'),
                onAction: () => { void repositoryImport.cancel(); },
            });
        };
        render();
        const listener = repositoryImport.onDidChange(render);
        repositoryImport.result.then(async result => {
            listener.dispose();
            repositoryImport.backgroundWatched = false;
            if (repositoryImport.presenter !== 'background') {
                return;
            }
            const next = await ctx.finishGithubRepositoryImport(result, false);
            if (next) {
                onProjectsChanged?.(next);
            }
            MobileSnackbar.show(
                nls.localize('qaap/repositoryImport/readyInBackground', '{0} is ready', result.repository.fullName),
                {
                    kind: 'success',
                    duration: 8000,
                    actionLabel: nls.localize('qaap/repositoryImport/openAction', 'Open'),
                    onAction: () => { void ctx.openWorkspaceUri(new URI(result.workspaceUri)); },
                }
            );
        }, (err: unknown) => {
            listener.dispose();
            repositoryImport.backgroundWatched = false;
            if (repositoryImport.presenter !== 'background') {
                return;
            }
            if (err instanceof QaapRepositoryImportError && err.cancelled) {
                MobileSnackbar.show(nls.localize('qaap/repositoryImport/cancelled', 'Import cancelled.'), { duration: 2400 });
                return;
            }
            MobileSnackbar.dismiss();
            void ctx.messageService.error(nls.localize(
                'qaap/repositoryImport/failedNamed',
                'Could not import {0}: {1}',
                repositoryImport.job.label,
                err instanceof Error ? err.message : String(err),
            ));
        });
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
        const repositoryImport = ctx.repositoryImports.start(
            { kind: 'open', owner: project.github.owner, name: project.github.name },
            project.github.fullName,
        );
        return runRepositoryImportWithSnackbarExtracted(ctx, repositoryImport);
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

