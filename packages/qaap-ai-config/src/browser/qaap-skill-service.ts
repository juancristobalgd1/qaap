// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject, optional, postConstruct } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { DefaultSkillService } from '@theia/ai-core/lib/browser/skill-service';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { Skill } from '@theia/ai-core/lib/common/skill';
import { readQaapAuthUser } from '@theia/qaap-adapters/src/browser/qaap-auth-session';
import {
    QaapProjectSkillRoots,
    qaapProjectSkillDirectoryPaths,
} from '@theia/qaap-adapters/lib/common/qaap-project-skill-roots';
import {
    QAAP_SYSTEM_SKILLS_DIR_ENV,
    qaapPerUserSkillsDirectory,
} from '../common/qaap-system-skills';

@injectable()
export class QaapSkillService extends DefaultSkillService {

    @inject(QaapProjectSkillRoots) @optional()
    protected readonly projectSkillRoots?: QaapProjectSkillRoots;

    @postConstruct()
    protected initQaapProjectSkillRoots(): void {
        this.projectSkillRoots?.onDidChange(() => this.scheduleUpdate());
    }

    protected override getWorkspaceSkillsDirectoryPaths(): string[] {
        const paths = super.getWorkspaceSkillsDirectoryPaths();
        if (!this.projectSkillRoots) {
            return paths;
        }
        const supplemental = this.projectSkillRoots.getProjectRootPaths().flatMap(root => qaapProjectSkillDirectoryPaths(root));
        return [...new Set([...supplemental, ...paths])];
    }

    /**
     * Qaap replaces upstream home-wide defaults (`~/.theia/skills`, `~/.agents/skills`) with:
     * - bundled system skills (same for every user), and
     * - per-user custom skills under `~/.qaap/users/{login}/skills`.
     */
    protected override async getDefaultSkillsDirectoryPaths(): Promise<string[]> {
        const envVar = await this.envVariablesServer.getValue(QAAP_SYSTEM_SKILLS_DIR_ENV);
        const systemDir = envVar?.value?.trim();
        return systemDir ? [systemDir] : [];
    }

    protected async getQaapUserSkillDirectories(homePath: string): Promise<string[]> {
        const user = readQaapAuthUser();
        if (!user?.login?.trim()) {
            return [];
        }
        return [qaapPerUserSkillsDirectory(homePath, user.login)];
    }

    protected override async update(): Promise<void> {
        await super.update();
        // Per-user skill roots run after bundled system skills. Do not await them here:
        // SkillPromptCoordinator blocks startup on skillService.ready, which resolves only
        // when this update() promise settles — hanging on env/home RPC or file watchers
        // leaves the UI on the splash/logo indefinitely.
        void this.refreshQaapUserSkillDirectories();
    }

    protected async refreshQaapUserSkillDirectories(): Promise<void> {
        const homeDirUri = await this.envVariablesServer.getHomeDirUri();
        const homePath = new URI(homeDirUri).path.fsPath();
        let changed = false;

        for (const directoryPath of await this.getQaapUserSkillDirectories(homePath)) {
            const directoryUri = URI.fromFilePath(directoryPath).toString();
            if (this.watchedDirectories.has(directoryUri)) {
                continue;
            }
            const before = this.skills.size;
            const extraDisposables = new DisposableCollection();
            const extraWatched = new Set<string>();
            const extraParentWatchers = new Map<string, string>();
            await this.processSkillDirectoryWithParentWatching(
                directoryPath,
                this.skills,
                extraDisposables,
                extraWatched,
                extraParentWatchers,
            );
            for (const watched of extraWatched) {
                this.watchedDirectories.add(watched);
            }
            for (const [parentUri, skillsPath] of extraParentWatchers) {
                this.parentWatchers.set(parentUri, skillsPath);
            }
            this.toDispose.push(extraDisposables);
            if (this.skills.size > before) {
                changed = true;
            }
        }

        if (changed) {
            this.onSkillsChangedEmitter.fire();
        }
    }

    protected override async processSkillDirectoryWithParentWatching(
        directoryPath: string,
        skills: Map<string, Skill>,
        disposables: DisposableCollection,
        watchedDirectories: Set<string>,
        parentWatchers: Map<string, string>
    ): Promise<void> {
        const dirURI = URI.fromFilePath(directoryPath);

        try {
            const dirExists = await this.fileService.exists(dirURI);

            if (dirExists) {
                await this.processExistingSkillDirectory(dirURI, skills, disposables, watchedDirectories);
            } else {
                const parentPath = dirURI.parent.path.fsPath();
                const parentURI = URI.fromFilePath(parentPath);
                const parentExists = await this.fileService.exists(parentURI);

                if (parentExists) {
                    const parentUriString = parentURI.toString();
                    disposables.push(this.fileService.watch(parentURI, { recursive: false, excludes: [] }));
                    parentWatchers.set(parentUriString, directoryPath);
                    this.logger.info(`Watching parent directory '${parentPath}' for skills folder creation`);
                } else {
                    this.logger.debug(`Skipping skills watch for '${directoryPath}': parent directory does not exist yet`);
                }
            }
        } catch (error) {
            this.logger.error(`Error processing directory '${directoryPath}': ${error}`);
        }
    }
}
