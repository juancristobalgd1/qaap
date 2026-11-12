// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import URI from '@theia/core/lib/common/uri';
import type { LabelProvider } from '@theia/core/lib/browser/label-provider';
import type { FileSearchService } from '@theia/file-search/lib/common/file-search-service';
import type { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import type { ComposerProjectFileMatch } from '@theia/qaap-composer/lib/browser/qaap-mobile-context-attach-menu';

/** Files listed by the composer's "File" view: enough to scroll, few enough to stay instant. */
const COMPOSER_PROJECT_FILE_SEARCH_LIMIT = 60;

/**
 * Fuzzy search over the open workspace roots for the composer attach menu (the in-composer
 * replacement of the top quick-pick). Results carry the root-prefixed path the `#file` variable
 * takes as its argument.
 */
export function createComposerProjectFileSearch(
    fileSearchService: FileSearchService,
    workspaceService: WorkspaceService,
    labelProvider?: LabelProvider,
): (query: string) => Promise<readonly ComposerProjectFileMatch[]> {
    return async query => {
        const rootUris = workspaceService.tryGetRoots().map(root => root.resource.toString());
        if (rootUris.length === 0) {
            return [];
        }
        const uris = await fileSearchService.find(query.trim(), {
            rootUris,
            fuzzyMatch: true,
            useGitIgnore: true,
            limit: COMPOSER_PROJECT_FILE_SEARCH_LIMIT,
            excludePatterns: ['**/node_modules/**', '**/.git/**'],
        });
        return uris.map(value => {
            const uri = new URI(value);
            const path = workspaceService.getRootPrefixedPath(uri);
            const slash = path.lastIndexOf('/');
            return {
                path,
                name: uri.path.base,
                folder: slash > 0 ? path.slice(0, slash) : '',
                // The file-icon theme class (the same icons Theia's quick pick and explorer show).
                iconClass: labelProvider?.getIcon(uri) || undefined,
            };
        });
    };
}
