// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { PreferenceDataProperty } from '@theia/core/lib/common/preferences';
import { PreferenceSchemaService } from '@theia/core/lib/common/preferences/preference-schema';
import {
    mergeBooleanDefaults,
    mergeStringArrayDefaults,
    QAAP_FILES_WATCHER_EXCLUDES,
    QAAP_GIT_SCAN_IGNORED_FOLDERS,
    QaapWorkspaceSafetyDefaultsContribution,
} from './qaap-workspace-safety-defaults-contribution';

describe('Qaap workspace safety defaults', () => {

    it('preserves upstream watcher exclusions while adding Qaap internal directories', () => {
        const merged = mergeBooleanDefaults({ '**/.git/objects/**': true }, QAAP_FILES_WATCHER_EXCLUDES);
        expect(merged).to.deep.equal({
            '**/.git/objects/**': true,
            '**/.worktrees/**': true,
            '**/.claude/worktrees/**': true,
            '**/.browser_modules/**': true,
        });
    });

    it('preserves and de-duplicates Git repository scan exclusions', () => {
        const merged = mergeStringArrayDefaults(['node_modules', '.worktrees'], QAAP_GIT_SCAN_IGNORED_FOLDERS);
        expect(merged).to.deep.equal([
            'node_modules',
            '.worktrees',
            '.claude',
            '.claude/worktrees',
            '.browser_modules',
        ]);
    });

    it('applies Git defaults when the plugin schema is registered after startup', () => {
        const properties = new Map<string, PreferenceDataProperty>([
            ['files.watcherExclude', { type: 'object', default: { '**/.git/objects/**': true } }],
        ]);
        let schemaChangeListener = (): void => undefined;
        const schemaService = {
            getSchemaProperty: (key: string) => properties.get(key),
            updateSchemaProperty: (key: string, property: PreferenceDataProperty) => {
                properties.set(key, property);
                schemaChangeListener();
            },
            onDidChangeSchema: (listener: () => void) => {
                schemaChangeListener = listener;
                return { dispose: (): void => undefined };
            },
        } as unknown as PreferenceSchemaService;
        const contribution = Object.create(QaapWorkspaceSafetyDefaultsContribution.prototype) as QaapWorkspaceSafetyDefaultsContribution;
        Object.assign(contribution, { schemaService, applyingDefaults: false });
        contribution.onStart();

        properties.set('git.detectWorktrees', { type: 'boolean', default: true });
        properties.set('git.repositoryScanIgnoredFolders', { type: 'array', default: ['node_modules'] });
        schemaChangeListener();

        expect(properties.get('git.detectWorktrees')?.default).to.equal(false);
        expect(properties.get('git.repositoryScanIgnoredFolders')?.default).to.deep.equal([
            'node_modules',
            '.worktrees',
            '.claude',
            '.claude/worktrees',
            '.browser_modules',
        ]);
    });
});
