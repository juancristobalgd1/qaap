// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { PreferenceDataProperty } from '@theia/core/lib/common/preferences';
import { PreferenceSchemaService } from '@theia/core/lib/common/preferences/preference-schema';
import { inject, injectable } from '@theia/core/shared/inversify';

export const QAAP_FILES_WATCHER_EXCLUDES = Object.freeze({
    '**/.worktrees/**': true,
    '**/.claude/worktrees/**': true,
    '**/.browser_modules/**': true,
});

export const QAAP_GIT_SCAN_IGNORED_FOLDERS = Object.freeze([
    '.worktrees',
    '.claude',
    '.claude/worktrees',
    '.browser_modules',
]);

export function mergeBooleanDefaults(current: unknown, required: Readonly<Record<string, boolean>>): Record<string, boolean> {
    const existing = current && typeof current === 'object' && !Array.isArray(current)
        ? current as Record<string, boolean>
        : {};
    return { ...existing, ...required };
}

export function mergeStringArrayDefaults(current: unknown, required: readonly string[]): string[] {
    const existing = Array.isArray(current) ? current.filter((value): value is string => typeof value === 'string') : [];
    return [...new Set([...existing, ...required])];
}

/** Keep internal agent worktrees out of general workspace and Git discovery. */
@injectable()
export class QaapWorkspaceSafetyDefaultsContribution implements FrontendApplicationContribution {

    @inject(PreferenceSchemaService)
    protected readonly schemaService: PreferenceSchemaService;

    protected applyingDefaults = false;

    onStart(): void {
        this.applyDefaults();
        // VS Code extension schemas can arrive after frontend contributions start. Re-apply when
        // Git registers its preferences; equality checks below keep this listener idempotent.
        this.schemaService.onDidChangeSchema(() => this.applyDefaults());
    }

    protected applyDefaults(): void {
        if (this.applyingDefaults) {
            return;
        }
        this.applyingDefaults = true;
        try {
            this.updateDefault('files.watcherExclude', current => mergeBooleanDefaults(current, QAAP_FILES_WATCHER_EXCLUDES));
            this.updateDefault('git.detectWorktrees', () => false);
            this.updateDefault('git.repositoryScanIgnoredFolders', current =>
                mergeStringArrayDefaults(current, QAAP_GIT_SCAN_IGNORED_FOLDERS));
        } finally {
            this.applyingDefaults = false;
        }
    }

    protected updateDefault(key: string, resolveDefault: (current: unknown) => unknown): void {
        const property = this.schemaService.getSchemaProperty(key);
        if (!property) {
            return;
        }
        const nextDefault = resolveDefault(property.default);
        if (JSON.stringify(nextDefault) === JSON.stringify(property.default)) {
            return;
        }
        this.schemaService.updateSchemaProperty(key, {
            ...property,
            default: nextDefault,
        } as PreferenceDataProperty);
    }
}
