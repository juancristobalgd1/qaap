// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

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
import { cloneGithubProjectByRepositoryExtracted, cloneGithubProjectExtracted, createGithubProjectExtracted, formatRepositoryLabelExtracted, importGithubProjectExtracted, isPinnedExtracted, openGithubProjectExtracted, openInCurrentWindowAsyncExtracted, openInNewWindowExtracted, openWorkspaceUriExtracted, readCustomProjectsExtracted, readDisplayNamesExtracted, readHiddenProjectIdsExtracted, readPinnedProjectIdsExtracted, registerGithubWorkspaceProjectExtracted, storedToEntryExtracted, togglePinExtracted, uniqueCopyNameExtracted, workspacePathFromUriExtracted, writeCustomProjectsExtracted, writeDisplayNamesExtracted, writeHiddenProjectIdsExtracted, writePinnedProjectIdsExtracted } from './mobile-projects-service-render2';
import { cachedGithubSessionToEntryExtracted, cachedSessionToEntryExtracted, cachedWorkspaceSessionToEntryExtracted, collapseCurrentWorkspaceDuplicatesExtracted, duplicateProjectExtracted, getCurrentWorkspaceBranchExtracted, getCurrentWorkspaceDisplayNameExtracted, getProjectCwdExtracted, isBrowsableHubProjectExtracted, loadProjectsExtracted, overlayActiveTasksExtracted, peekCachedProjectsExtracted, removeProjectExtracted, renameProjectExtracted } from './mobile-projects-service-streaming2';
import { applySessionToEntryExtracted, buildEphemeralCurrentWorkspaceEntryExtracted, currentGithubRepositoryFullNameExtracted, currentRepoKeyExtracted, cwdFromFileUriExtracted, filterProjectsExtracted, getCurrentWorkspaceMatchKeyExtracted, getProjectWorkspaceMatchKeyExtracted, githubRepositoryToProjectExtracted, isProjectContainerWorkspaceExtracted, latestTimestampExtracted, loadGithubProjectsExtracted, loadSessionMapExtracted, prepareProjectCwdExtracted, projectActivityTimeExtracted, projectMatchesCurrentWorkspaceExtracted, projectSessionKeyExtracted, recordProjectPreviewUrlExtracted, recordProjectSessionExtracted, relativeUpdatedAtExtracted, resolveCurrentWorkspaceProjectExtracted, resolveProjectPreviewUrlExtracted, touchProjectActivityExtracted, touchProjectSessionExtracted } from './mobile-projects-service-timeline2';

export const HIDDEN_PROJECT_IDS_STORAGE_KEY = MOBILE_PROJECTS_HIDDEN_IDS_BASE;
export const PINNED_PROJECT_IDS_STORAGE_KEY = MOBILE_PROJECTS_PINNED_IDS_BASE;
export const DISPLAY_NAMES_STORAGE_KEY = MOBILE_PROJECTS_DISPLAY_NAMES_BASE;
export const CUSTOM_PROJECTS_STORAGE_KEY = MOBILE_PROJECTS_CUSTOM_PROJECTS_BASE;

@injectable()
export class MobileProjectsService {

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(LabelProvider)
    protected readonly labelProvider: LabelProvider;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(MobileProjectsActiveTasks)
    protected readonly activeTasks: MobileProjectsActiveTasks;

    protected filter: MobileProjectFilter = 'all';
    protected hubView: MobileProjectsHubView = 'tasks';

    protected readHiddenProjectIds(): Set<string> {
        return readHiddenProjectIdsExtracted(this);
    }

    protected writeHiddenProjectIds(ids: Set<string>): void {
        writeHiddenProjectIdsExtracted(this, ids);
    }

    protected readPinnedProjectIds(): Set<string> {
        return readPinnedProjectIdsExtracted(this);
    }

    protected writePinnedProjectIds(ids: Set<string>): void {
        writePinnedProjectIdsExtracted(this, ids);
    }

    protected isPinned(id: string, pinnedIds: Set<string>, defaultPinned: boolean): boolean {
        return isPinnedExtracted(this, id, pinnedIds, defaultPinned);
    }

    togglePin(project: MobileProjectEntry): boolean {
        return togglePinExtracted(this, project);
    }

    canOpenInNewWindow(project: MobileProjectEntry): boolean {
        return !!project.uri || !!project.github;
    }

    protected workspacePathFromUri(uri: URI): string {
        return workspacePathFromUriExtracted(this, uri);
    }

    openWorkspaceUri(uri: URI): void {
        openWorkspaceUriExtracted(this, uri);
    }

    protected formatRepositoryLabel(repository: string): string {
        return formatRepositoryLabelExtracted(this, repository);
    }

    openInCurrentWindow(project: MobileProjectEntry): void {
        void this.openInCurrentWindowAsync(project);
    }

    async openInCurrentWindowAsync(project: MobileProjectEntry): Promise<void> {
        return openInCurrentWindowAsyncExtracted(this, project);
    }

    openInNewWindow(project: MobileProjectEntry): void {
        openInNewWindowExtracted(this, project);
    }

    protected async openGithubProject(project: MobileProjectEntry, newWindow = false): Promise<void> {
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

    /** Profile of the currently signed-in GitHub user, when known. */
    getConnectedUser(): QaapAuthUser | undefined {
        return readQaapAuthUser();
    }

    /** Public access to the list of GitHub repositories visible to the signed-in user. */
    async listGithubRepositories(): Promise<MobileProjectEntry[]> {
        const sessionMap = await this.loadSessionMap();
        return this.sortProjectsByRecent(await this.loadGithubProjects(sessionMap, true));
    }

    protected readDisplayNames(): Record<string, string> {
        return readDisplayNamesExtracted(this);
    }

    protected writeDisplayNames(names: Record<string, string>): void {
        writeDisplayNamesExtracted(this, names);
    }

    protected readCustomProjects(): StoredMobileProject[] {
        return readCustomProjectsExtracted(this);
    }

    protected writeCustomProjects(projects: StoredMobileProject[]): void {
        writeCustomProjectsExtracted(this, projects);
    }

    async importGithubProject(project: MobileProjectEntry): Promise<MobileProjectEntry[] | undefined> {
        return importGithubProjectExtracted(this, project);
    }

    protected registerGithubWorkspaceProject(repository: QaapGithubRepositorySummary, uri: URI): void {
        registerGithubWorkspaceProjectExtracted(this, repository, uri);
    }

    protected resolveDisplayName(id: string, defaultName: string): string {
        const override = this.readDisplayNames()[id];
        return override?.trim() || defaultName;
    }

    protected storedToEntry(stored: StoredMobileProject, pinnedIds: Set<string>): MobileProjectEntry {
        return storedToEntryExtracted(this, stored, pinnedIds);
    }

    protected uniqueCopyName(base: string, existingNames: string[]): string {
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
        return peekCachedProjectsExtracted(this);
    }

    protected isBrowsableHubProject(project: MobileProjectEntry): boolean {
        return isBrowsableHubProjectExtracted(this, project);
    }

    protected cachedSessionToEntry(session: QaapProjectSessionSummary, pinnedIds: Set<string>, current: URI | undefined,): MobileProjectEntry | undefined {
        return cachedSessionToEntryExtracted(this, session, pinnedIds, current);
    }

    protected cachedGithubSessionToEntry(session: QaapProjectSessionSummary, pinnedIds: Set<string>, current: URI | undefined,): MobileProjectEntry | undefined {
        return cachedGithubSessionToEntryExtracted(this, session, pinnedIds, current);
    }

    protected cachedWorkspaceSessionToEntry(session: QaapProjectSessionSummary, pinnedIds: Set<string>, current: URI | undefined,): MobileProjectEntry | undefined {
        return cachedWorkspaceSessionToEntryExtracted(this, session, pinnedIds, current);
    }

    async loadProjects(): Promise<MobileProjectEntry[]> {
        return loadProjectsExtracted(this);
    }

    protected collapseCurrentWorkspaceDuplicates(entries: MobileProjectEntry[]): MobileProjectEntry[] {
        return collapseCurrentWorkspaceDuplicatesExtracted(this, entries);
    }

    protected normalizeProjectName(name: string | undefined): string | undefined {
        const normalized = name?.trim().toLowerCase();
        return normalized || undefined;
    }

    protected overlayActiveTasks(projects: MobileProjectEntry[]): MobileProjectEntry[] {
        return overlayActiveTasksExtracted(this, projects);
    }

    getProjectCwd(project: MobileProjectEntry): string | undefined {
        return getProjectCwdExtracted(this, project);
    }

    getCurrentWorkspaceCwd(): string | undefined {
        return this.cwdFromFileUri(this.workspaceService.workspace?.resource);
    }

    getCurrentWorkspaceName(): string | undefined {
        const uri = this.workspaceService.workspace?.resource;
        return uri ? this.labelProvider.getName(uri) : undefined;
    }

    async prepareProjectCwd(project: MobileProjectEntry): Promise<string | undefined> {
        return prepareProjectCwdExtracted(this, project);
    }

    protected cwdForProject(project: MobileProjectEntry): string | undefined {
        return this.getProjectCwd(project);
    }

    protected cwdFromFileUri(uri: URI | undefined): string | undefined {
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

    protected touchProjectActivity(project: MobileProjectEntry): void {
        touchProjectActivityExtracted(this, project);
    }

    protected touchWorkspaceActivity(uri: URI): void {
        this.touchProjectSession(`ws:${uri.toString()}`, uri.path.base);
    }

    protected touchProjectSession(repoKey: string, branch: string): void {
        touchProjectSessionExtracted(this, repoKey, branch);
    }

    protected touchGithubRepositoryActivity(repository: QaapGithubRepositorySummary): void {
        this.touchProjectSession(`github:${repository.fullName}`, repository.defaultBranch);
    }

    protected projectSessionKey(project: MobileProjectEntry): string | undefined {
        return projectSessionKeyExtracted(this, project);
    }

    protected currentRepoKey(): string | undefined {
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

    protected isProjectContainerWorkspace(workspaceCwd: string | undefined, projects: readonly MobileProjectEntry[],): boolean {
        return isProjectContainerWorkspaceExtracted(this, workspaceCwd, projects);
    }

    protected buildEphemeralCurrentWorkspaceEntry(): MobileProjectEntry | undefined {
        return buildEphemeralCurrentWorkspaceEntryExtracted(this);
    }

    protected async loadSessionMap(): Promise<Map<string, QaapProjectSessionSummary>> {
        return loadSessionMapExtracted(this);
    }

    protected applySessionToEntry(entry: MobileProjectEntry, session?: QaapProjectSessionSummary): MobileProjectEntry {
        return applySessionToEntryExtracted(this, entry, session);
    }

    protected async loadGithubProjects(sessionMap: Map<string, QaapProjectSessionSummary>, includeUnopened: boolean): Promise<MobileProjectEntry[]> {
        return loadGithubProjectsExtracted(this, sessionMap, includeUnopened);
    }

    protected currentGithubRepositoryFullName(): string | undefined {
        return currentGithubRepositoryFullNameExtracted(this);
    }

    protected githubRepositoryToProject(repo: QaapGithubRepositorySummary, pinnedIds: Set<string>, currentFullName?: string): MobileProjectEntry {
        return githubRepositoryToProjectExtracted(this, repo, pinnedIds, currentFullName);
    }

    protected relativeUpdatedAt(value: string): string {
        return relativeUpdatedAtExtracted(this, value);
    }

    protected sortProjectsByRecent(projects: MobileProjectEntry[]): MobileProjectEntry[] {
        return [...projects].sort((a, b) => this.projectActivityTime(b) - this.projectActivityTime(a));
    }

    protected projectActivityTime(project: MobileProjectEntry): number {
        return projectActivityTimeExtracted(this, project);
    }

    protected latestTimestamp(a?: string, b?: string): string | undefined {
        return latestTimestampExtracted(this, a, b);
    }

    filterProjects(projects: MobileProjectEntry[], filter: MobileProjectFilter): MobileProjectEntry[] {
        return filterProjectsExtracted(this, projects, filter);
    }

    countActive(projects: MobileProjectEntry[]): number {
        return projects.filter(p => p.status === 'working' || p.status === 'review').length;
    }

    getInitials(name: string): string {
        return mobileProjectInitials(name);
    }
}
