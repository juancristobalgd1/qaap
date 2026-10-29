// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { DEFAULT_WINDOW_HASH } from '@theia/core/lib/common/window';
import { LabelProvider } from '@theia/core/lib/browser';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import type {
    QaapGithubOpenRepositoryResponse,
    QaapGithubRepositorySummary,
    QaapGithubWorkspaceJobRequest,
    QaapProjectSessionSummary,
    QaapProjectSessionUpsertRequest,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { readQaapAuthUser, type QaapAuthUser } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { QaapRepositoryImport, QaapRepositoryImportTracker } from './qaap-repository-import-tracker';
import {
    MobileProjectEntry,
    MobileProjectFilter,
    MobileProjectsHubView,
    mobileProjectInitials,
    StoredMobileProject,
} from './mobile-projects-types';
import { normalizeWorkHubViewId } from '../common/qaap-work-hub-surfaces';
import { MobileProjectsActiveTasks } from './mobile-projects-active-tasks';
import { MobileProjectFolderTrust } from './mobile-projects-folder-trust';
import {
    MOBILE_PROJECTS_CUSTOM_PROJECTS_BASE,
    MOBILE_PROJECTS_DISPLAY_NAMES_BASE,
    MOBILE_PROJECTS_HIDDEN_IDS_BASE,
    MOBILE_PROJECTS_PINNED_IDS_BASE,
} from './mobile-projects-user-storage';
import { cloneGithubProjectByRepositoryExtracted, cloneGithubProjectExtracted, createGithubProjectExtracted, finishGithubRepositoryImportExtracted, watchGithubRepositoryImportInBackgroundExtracted, formatRepositoryLabelExtracted, importGithubProjectExtracted, isPinnedExtracted, openGithubProjectExtracted, openInCurrentWindowAsyncExtracted, openProjectWithoutReloadExtracted, openWorkspaceUriExtracted, readCustomProjectsExtracted, readDisplayNamesExtracted, readHiddenProjectIdsExtracted, readPinnedProjectIdsExtracted, registerGithubWorkspaceProjectExtracted, storedToEntryExtracted, togglePinExtracted, uniqueCopyNameExtracted, workspacePathFromUriExtracted, writeCustomProjectsExtracted, writeDisplayNamesExtracted, writeHiddenProjectIdsExtracted, writePinnedProjectIdsExtracted } from './mobile-projects-service-render';
import { cachedGithubSessionToEntryExtracted, cachedSessionToEntryExtracted, cachedWorkspaceSessionToEntryExtracted, collapseCurrentWorkspaceDuplicatesExtracted, duplicateProjectExtracted, getCurrentWorkspaceBranchExtracted, getCurrentWorkspaceDisplayNameExtracted, getProjectCwdExtracted, isBrowsableHubProjectExtracted, loadProjectsExtracted, overlayActiveTasksExtracted, peekCachedProjectsExtracted, removeProjectExtracted, renameProjectExtracted } from './mobile-projects-service-streaming';
import { applySessionToEntryExtracted, buildEphemeralCurrentWorkspaceEntryExtracted, currentGithubRepositoryFullNameExtracted, currentRepoKeyExtracted, cwdFromFileUriExtracted, getCurrentWorkspaceMatchKeyExtracted, getProjectWorkspaceMatchKeyExtracted, githubRepositoryToProjectExtracted, isProjectContainerWorkspaceExtracted, latestTimestampExtracted, loadGithubProjectsExtracted, loadSessionMapExtracted, prepareProjectCwdExtracted, projectActivityTimeExtracted, projectMatchesCurrentWorkspaceExtracted, projectSessionKeyExtracted, recordProjectPreviewUrlExtracted, recordProjectSessionExtracted, relativeUpdatedAtExtracted, resolveCurrentWorkspaceProjectExtracted, resolveProjectPreviewUrlExtracted, touchProjectActivityExtracted, touchProjectSessionExtracted } from './mobile-projects-service-timeline';

export const HIDDEN_PROJECT_IDS_STORAGE_KEY = MOBILE_PROJECTS_HIDDEN_IDS_BASE;
export const PINNED_PROJECT_IDS_STORAGE_KEY = MOBILE_PROJECTS_PINNED_IDS_BASE;
export const DISPLAY_NAMES_STORAGE_KEY = MOBILE_PROJECTS_DISPLAY_NAMES_BASE;
export const CUSTOM_PROJECTS_STORAGE_KEY = MOBILE_PROJECTS_CUSTOM_PROJECTS_BASE;

@injectable()
export class MobileProjectsService {

    /** Workspace URI this device last had open (predicts the backend default before it answers). */
    protected static readonly LAST_WORKSPACE_KEY = 'qaap.mobileProjects.lastWorkspaceUri';

    @inject(WorkspaceService)
    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public readonly workspaceService: WorkspaceService;

    @inject(FileService)
    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public readonly fileService: FileService;

    @inject(LabelProvider)
    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public readonly labelProvider: LabelProvider;

    @inject(WindowService)
    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public readonly windowService: WindowService;

    @inject(MessageService)
    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public readonly messageService: MessageService;

    @inject(MobileProjectsActiveTasks)
    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public readonly activeTasks: MobileProjectsActiveTasks;

    protected filter: MobileProjectFilter = 'all';
    protected hubView: MobileProjectsHubView = 'tasks';

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public readHiddenProjectIds(): Set<string> {
        return readHiddenProjectIdsExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public writeHiddenProjectIds(ids: Set<string>): void {
        writeHiddenProjectIdsExtracted(this, ids);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public readPinnedProjectIds(): Set<string> {
        return readPinnedProjectIdsExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public writePinnedProjectIds(ids: Set<string>): void {
        writePinnedProjectIdsExtracted(this, ids);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public isPinned(id: string, pinnedIds: Set<string>, defaultPinned: boolean): boolean {
        return isPinnedExtracted(this, id, pinnedIds, defaultPinned);
    }

    togglePin(project: MobileProjectEntry): boolean {
        return togglePinExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public workspacePathFromUri(uri: URI): string {
        return workspacePathFromUriExtracted(this, uri);
    }

    openWorkspaceUri(uri: URI): Promise<boolean> {
        return openWorkspaceUriExtracted(this, uri);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public formatRepositoryLabel(repository: string): string {
        return formatRepositoryLabelExtracted(this, repository);
    }

    openInCurrentWindow(project: MobileProjectEntry): void {
        void this.openInCurrentWindowAsync(project);
    }

    /** Resolves `true` when the workspace open (and page reload) was issued. */
    async openInCurrentWindowAsync(project: MobileProjectEntry): Promise<boolean> {
        return openInCurrentWindowAsyncExtracted(this, project);
    }

    /** Resolves `true` when the project became this page's workspace without a reload. */
    async openProjectWithoutReload(project: MobileProjectEntry): Promise<boolean> {
        return openProjectWithoutReloadExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public async openGithubProject(project: MobileProjectEntry, newWindow = false): Promise<boolean> {
        return openGithubProjectExtracted(this, project, newWindow);
    }

    async createGithubProject(): Promise<MobileProjectEntry[] | undefined> {
        return createGithubProjectExtracted(this);
    }

    async cloneGithubProject(): Promise<MobileProjectEntry[] | undefined> {
        return cloneGithubProjectExtracted(this);
    }

    async cloneGithubProjectByRepository(repository: string): Promise<MobileProjectEntry[] | undefined> {
        return cloneGithubProjectByRepositoryExtracted(this, repository);
    }

    /** Background clone/open jobs of this window; progress survives closing the dialog. */
    readonly repositoryImports = new QaapRepositoryImportTracker();

    /** Start (or join) a background repository import with live progress. */
    startGithubRepositoryImport(request: QaapGithubWorkspaceJobRequest, label: string): QaapRepositoryImport {
        return this.repositoryImports.start(request, label);
    }

    /** Register a finished import as a project; `open` also switches the workspace (page reload). */
    async finishGithubRepositoryImport(result: QaapGithubOpenRepositoryResponse, open: boolean): Promise<MobileProjectEntry[] | undefined> {
        const projects = await finishGithubRepositoryImportExtracted(this, result, open);
        // `open` reloads the page, and the reloaded page asks through loadProjects. Otherwise ask now.
        if (!open) {
            const cwd = this.cwdFromFileUri(new URI(result.workspaceUri));
            if (cwd) {
                void this.folderTrust.askIfUndecided(cwd, result.repository.fullName);
            }
        }
        return projects;
    }

    /** Keep showing progress of an import whose dialog was closed, and list the project when done. */
    watchGithubRepositoryImportInBackground(
        repositoryImport: QaapRepositoryImport,
        onProjectsChanged?: (next: MobileProjectEntry[]) => void,
    ): void {
        watchGithubRepositoryImportInBackgroundExtracted(this, repositoryImport, onProjectsChanged);
    }

    /** Profile of the currently signed-in GitHub user, when known. */
    getConnectedUser(): QaapAuthUser | undefined {
        return readQaapAuthUser();
    }

    /** Public access to the list of GitHub repositories visible to the signed-in user. */
    async listGithubRepositories(): Promise<MobileProjectEntry[]> {
        const sessionMap = await this.loadSessionMap();
        return this.sortProjectsByRecent(await this.loadGithubProjects(sessionMap, true));
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public readDisplayNames(): Record<string, string> {
        return readDisplayNamesExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public writeDisplayNames(names: Record<string, string>): void {
        writeDisplayNamesExtracted(this, names);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public readCustomProjects(): StoredMobileProject[] {
        return readCustomProjectsExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public writeCustomProjects(projects: StoredMobileProject[]): void {
        writeCustomProjectsExtracted(this, projects);
    }

    async importGithubProject(project: MobileProjectEntry): Promise<MobileProjectEntry[] | undefined> {
        return importGithubProjectExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public registerGithubWorkspaceProject(repository: QaapGithubRepositorySummary, uri: URI): void {
        registerGithubWorkspaceProjectExtracted(this, repository, uri);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public resolveDisplayName(id: string, defaultName: string): string {
        const override = this.readDisplayNames()[id];
        return override?.trim() || defaultName;
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public storedToEntry(stored: StoredMobileProject, pinnedIds: Set<string>): MobileProjectEntry {
        return storedToEntryExtracted(this, stored, pinnedIds);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public uniqueCopyName(base: string, existingNames: string[]): string {
        return uniqueCopyNameExtracted(this, base, existingNames);
    }

    async renameProject(project: MobileProjectEntry): Promise<boolean> {
        return renameProjectExtracted(this, project);
    }

    async duplicateProject(project: MobileProjectEntry): Promise<boolean> {
        return duplicateProjectExtracted(this, project);
    }

    canRemove(project: MobileProjectEntry): boolean {
        return !project.isCurrent;
    }

    async removeProject(project: MobileProjectEntry): Promise<boolean> {
        return removeProjectExtracted(this, project);
    }

    /**
     * Projects the user confirmed deleting whose backend removal is still in flight. Every project
     * list this service returns omits them, so a background reload (active-task refresh, sidebar
     * prepare) cannot resurrect an optimistically removed row before persistence finishes.
     */
    protected readonly pendingRemovalProjectIds = new Set<string>();
    /** Lower-cased workspace URIs of {@link pendingRemovalProjectIds}, so synthetic `ws:` rows for the same folder stay hidden too. */
    protected readonly pendingRemovalProjectUris = new Map<string, string>();

    markProjectRemovalPending(projectId: string, uri?: { toString(): string }): void {
        this.pendingRemovalProjectIds.add(projectId);
        if (uri) {
            this.pendingRemovalProjectUris.set(projectId, uri.toString().toLowerCase());
        }
    }

    clearProjectRemovalPending(projectId: string): void {
        this.pendingRemovalProjectIds.delete(projectId);
        this.pendingRemovalProjectUris.delete(projectId);
    }

    isProjectRemovalPending(projectId: string, uri?: { toString(): string }): boolean {
        if (this.pendingRemovalProjectIds.has(projectId)) {
            return true;
        }
        if (!uri || this.pendingRemovalProjectUris.size === 0) {
            return false;
        }
        const key = uri.toString().toLowerCase();
        for (const pendingUri of this.pendingRemovalProjectUris.values()) {
            if (pendingUri === key) {
                return true;
            }
        }
        return false;
    }

    protected withoutPendingRemovals(projects: MobileProjectEntry[]): MobileProjectEntry[] {
        return this.pendingRemovalProjectIds.size === 0
            ? projects
            : projects.filter(project => !this.isProjectRemovalPending(project.id, project.uri));
    }

    getCurrentWorkspaceDisplayName(): string | undefined {
        return getCurrentWorkspaceDisplayNameExtracted(this);
    }

    getCurrentWorkspaceBranch(): string | undefined {
        return getCurrentWorkspaceBranchExtracted(this);
    }

    getFilter(): MobileProjectFilter {
        return this.filter;
    }

    setFilter(filter: MobileProjectFilter): void {
        this.filter = filter;
    }

    getHubView(): MobileProjectsHubView {
        return normalizeWorkHubViewId(this.hubView) as MobileProjectsHubView;
    }

    setHubView(view: MobileProjectsHubView): void {
        const normalized = normalizeWorkHubViewId(view) as MobileProjectsHubView;
        this.hubView = normalized;
    }

    peekCachedProjects(): MobileProjectEntry[] {
        return this.withoutPendingRemovals(peekCachedProjectsExtracted(this));
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public isBrowsableHubProject(project: MobileProjectEntry): boolean {
        return isBrowsableHubProjectExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public cachedSessionToEntry(session: QaapProjectSessionSummary, pinnedIds: Set<string>, current: URI | undefined,): MobileProjectEntry | undefined {
        return cachedSessionToEntryExtracted(this, session, pinnedIds, current);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public cachedGithubSessionToEntry(session: QaapProjectSessionSummary, pinnedIds: Set<string>, current: URI | undefined,): MobileProjectEntry | undefined {
        return cachedGithubSessionToEntryExtracted(this, session, pinnedIds, current);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public cachedWorkspaceSessionToEntry(session: QaapProjectSessionSummary, pinnedIds: Set<string>, current: URI | undefined,): MobileProjectEntry | undefined {
        return cachedWorkspaceSessionToEntryExtracted(this, session, pinnedIds, current);
    }

    async loadProjects(): Promise<MobileProjectEntry[]> {
        const projects = this.withoutPendingRemovals(await loadProjectsExtracted(this));
        // The current project is the one the Work Hub is working in; a reload after "Open" lands here too.
        for (const project of projects) {
            if (project.isCurrent) {
                this.askFolderTrustIfUndecided(project);
            }
        }
        return projects;
    }

    /** "Do you trust the files in this folder?" for the project's folder, when no decision exists yet. */
    readonly folderTrust = new MobileProjectFolderTrust();

    askFolderTrustIfUndecided(project: MobileProjectEntry): void {
        const cwd = this.getProjectCwd(project);
        if (cwd) {
            void this.folderTrust.askIfUndecided(cwd, project.name);
        }
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public collapseCurrentWorkspaceDuplicates(entries: MobileProjectEntry[]): MobileProjectEntry[] {
        return collapseCurrentWorkspaceDuplicatesExtracted(this, entries);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public normalizeProjectName(name: string | undefined): string | undefined {
        const normalized = name?.trim().toLowerCase();
        return normalized || undefined;
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public overlayActiveTasks(projects: MobileProjectEntry[]): MobileProjectEntry[] {
        return overlayActiveTasksExtracted(this, projects);
    }

    getProjectCwd(project: MobileProjectEntry): string | undefined {
        return getProjectCwdExtracted(this, project);
    }

    protected workspaceResolved = false;
    protected workspaceResolutionTracked = false;
    protected rememberedWorkspaceUri: string | undefined;

    /**
     * The open workspace. Before WorkspaceService has resolved it (a backend round trip, while
     * the phone Work Hub already paints from caches), it is predicted the way WorkspaceService
     * will resolve it: the URL fragment, else the workspace this device last had open (a fragment-
     * less load, e.g. the PWA start URL, gets the backend's most recently used workspace). So the
     * Work Hub's first paint names the same workspace as its settled state, not a cached fallback.
     */
    currentWorkspaceUri(): URI | undefined {
        const resolved = this.workspaceService.workspace?.resource;
        if (resolved) {
            this.rememberWorkspaceUri(resolved);
            return resolved;
        }
        if (!this.workspaceResolutionTracked) {
            this.workspaceResolutionTracked = true;
            const ready = this.workspaceService.ready as Promise<void> | undefined;
            if (ready) {
                ready.then(() => {
                    this.workspaceResolved = true;
                    // Remember it now, not only when a later render asks: the next load predicts from it.
                    const settled = this.workspaceService.workspace?.resource;
                    if (settled) {
                        this.rememberWorkspaceUri(settled);
                    }
                }, () => { this.workspaceResolved = true; });
            } else {
                this.workspaceResolved = true;
            }
        }
        if (this.workspaceResolved) {
            return undefined;
        }
        return this.workspaceUriFromLocationHash() ?? this.lastWorkspaceUri();
    }

    protected rememberWorkspaceUri(uri: URI): void {
        const value = uri.toString();
        if (value === this.rememberedWorkspaceUri) {
            return;
        }
        this.rememberedWorkspaceUri = value;
        try {
            window.localStorage.setItem(MobileProjectsService.LAST_WORKSPACE_KEY, value);
        } catch {
            // Storage unavailable: the first paint falls back to the cached project list.
        }
    }

    protected lastWorkspaceUri(): URI | undefined {
        if (typeof window === 'undefined' || (window.location.hash.length > 1)) {
            return undefined;
        }
        try {
            const value = window.localStorage.getItem(MobileProjectsService.LAST_WORKSPACE_KEY);
            return value && value.startsWith('file:') ? new URI(value) : undefined;
        } catch {
            return undefined;
        }
    }

    /** Mirrors WorkspaceService.doGetDefaultWorkspaceUri (URL fragment, UNC paths included). */
    protected workspaceUriFromLocationHash(): URI | undefined {
        if (typeof window === 'undefined') {
            return undefined;
        }
        const hash = window.location.hash;
        if (hash.length <= 1 || hash === `#${DEFAULT_WINDOW_HASH}`) {
            return undefined;
        }
        try {
            const workspacePath = decodeURI(hash.substring(1));
            if (workspacePath.startsWith('//')) {
                const unc = workspacePath.slice(2);
                const firstSlash = unc.indexOf('/');
                const authority = firstSlash >= 0 ? unc.slice(0, firstSlash) : unc;
                const path = firstSlash >= 0 ? unc.slice(firstSlash) : '/';
                return new URI().withPath(path).withAuthority(authority).withScheme('file');
            }
            return new URI().withPath(workspacePath).withScheme('file');
        } catch {
            return undefined;
        }
    }

    getCurrentWorkspaceCwd(): string | undefined {
        return this.cwdFromFileUri(this.currentWorkspaceUri());
    }

    getCurrentWorkspaceName(): string | undefined {
        const uri = this.currentWorkspaceUri();
        return uri ? this.labelProvider.getName(uri) : undefined;
    }

    async prepareProjectCwd(project: MobileProjectEntry): Promise<string | undefined> {
        return prepareProjectCwdExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public cwdForProject(project: MobileProjectEntry): string | undefined {
        return this.getProjectCwd(project);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public cwdFromFileUri(uri: URI | undefined): string | undefined {
        return cwdFromFileUriExtracted(this, uri);
    }

    async recordProjectSession(patch: Omit<QaapProjectSessionUpsertRequest, 'repoKey'> & { repoKey?: string }): Promise<void> {
        return recordProjectSessionExtracted(this, patch);
    }

    async recordProjectPreviewUrl(project: MobileProjectEntry, previewUrl: string): Promise<void> {
        return recordProjectPreviewUrlExtracted(this, project, previewUrl);
    }

    async resolveProjectPreviewUrl(project: MobileProjectEntry, cwd?: string): Promise<string | undefined> {
        return resolveProjectPreviewUrlExtracted(this, project, cwd);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public touchProjectActivity(project: MobileProjectEntry): void {
        touchProjectActivityExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public touchWorkspaceActivity(uri: URI): void {
        this.touchProjectSession(`ws:${uri.toString()}`, uri.path.base);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public touchProjectSession(repoKey: string, branch: string): void {
        touchProjectSessionExtracted(this, repoKey, branch);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public touchGithubRepositoryActivity(repository: QaapGithubRepositorySummary): void {
        this.touchProjectSession(`github:${repository.fullName}`, repository.defaultBranch);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public projectSessionKey(project: MobileProjectEntry): string | undefined {
        return projectSessionKeyExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public currentRepoKey(): string | undefined {
        return currentRepoKeyExtracted(this);
    }

    getProjectWorkspaceMatchKey(project: MobileProjectEntry): string | undefined {
        return getProjectWorkspaceMatchKeyExtracted(this, project);
    }

    getCurrentWorkspaceMatchKey(): string | undefined {
        return getCurrentWorkspaceMatchKeyExtracted(this);
    }

    projectMatchesCurrentWorkspace(project: MobileProjectEntry): boolean {
        return projectMatchesCurrentWorkspaceExtracted(this, project);
    }

    resolveCurrentWorkspaceProject(projects: readonly MobileProjectEntry[]): MobileProjectEntry | undefined {
        return resolveCurrentWorkspaceProjectExtracted(this, projects);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public isProjectContainerWorkspace(workspaceCwd: string | undefined, projects: readonly MobileProjectEntry[],): boolean {
        return isProjectContainerWorkspaceExtracted(this, workspaceCwd, projects);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public buildEphemeralCurrentWorkspaceEntry(): MobileProjectEntry | undefined {
        return buildEphemeralCurrentWorkspaceEntryExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public async loadSessionMap(): Promise<Map<string, QaapProjectSessionSummary>> {
        return loadSessionMapExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public applySessionToEntry(entry: MobileProjectEntry, session?: QaapProjectSessionSummary): MobileProjectEntry {
        return applySessionToEntryExtracted(this, entry, session);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public async loadGithubProjects(sessionMap: Map<string, QaapProjectSessionSummary>, includeUnopened: boolean): Promise<MobileProjectEntry[]> {
        return loadGithubProjectsExtracted(this, sessionMap, includeUnopened);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public currentGithubRepositoryFullName(): string | undefined {
        return currentGithubRepositoryFullNameExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public githubRepositoryToProject(repo: QaapGithubRepositorySummary, pinnedIds: Set<string>, currentFullName?: string): MobileProjectEntry {
        return githubRepositoryToProjectExtracted(this, repo, pinnedIds, currentFullName);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public relativeUpdatedAt(value: string): string {
        return relativeUpdatedAtExtracted(this, value);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public sortProjectsByRecent(projects: MobileProjectEntry[]): MobileProjectEntry[] {
        return [...projects].sort((a, b) => this.projectActivityTime(b) - this.projectActivityTime(a));
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public projectActivityTime(project: MobileProjectEntry): number {
        return projectActivityTimeExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-service-* modules. */
    public latestTimestamp(a?: string, b?: string): string | undefined {
        return latestTimestampExtracted(this, a, b);
    }

    getInitials(name: string): string {
        return mobileProjectInitials(name);
    }
}
