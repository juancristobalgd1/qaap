// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import type { FileSearchService } from '@theia/file-search/lib/common/file-search-service';
import type { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { createComposerProjectFileSearch } from './qaap-composer-project-file-search';

describe('createComposerProjectFileSearch', () => {

    function createFileSearch(options: { roots: string[]; found?: string[] }): {
        search: ReturnType<typeof createComposerProjectFileSearch>;
        findCalls: { rootUris: string[] }[];
    } {
        const findCalls: { rootUris: string[] }[] = [];
        const fileSearchService = {
            find: async (_pattern: string, searchOptions: { rootUris: string[] }) => {
                findCalls.push({ rootUris: searchOptions.rootUris });
                return options.found ?? ['file:///proj/src/a.ts'];
            },
        } as unknown as FileSearchService;
        const workspaceService = {
            tryGetRoots: () => options.roots.map(root => ({ resource: new URI(root) })),
            getRootPrefixedPath: (uri: URI) => `/root${uri.path.toString()}`,
        } as unknown as WorkspaceService;
        return { search: createComposerProjectFileSearch(fileSearchService, workspaceService), findCalls };
    }

    it('searches the fallback project folder when no workspace root is open', async () => {
        const { search, findCalls } = createFileSearch({ roots: [] });

        const matches = await search('a', 'file:///proj');

        expect(findCalls).to.have.length(1);
        expect(findCalls[0].rootUris).to.deep.equal(['file:///proj']);
        // The `#file` argument is the native absolute path (`\\proj\\src\\a.ts` on Windows hosts).
        const nativePath = new URI('file:///proj/src/a.ts').path.fsPath();
        expect(matches).to.deep.equal([{ path: nativePath, name: 'a.ts', folder: 'src', iconClass: undefined }]);
    });

    it('keeps the backend path whatever OS the frontend runs on, dropping only a drive letter\'s leading slash', async () => {
        const { search } = createFileSearch({ roots: [], found: ['file:///c%3A/proj/src/a.ts'] });

        const matches = await search('a', 'file:///c%3A/proj');

        expect(matches.map(match => match.path)).to.deep.equal(['c:/proj/src/a.ts']);
    });

    it('ignores the fallback folder when workspace roots are present', async () => {
        const { search, findCalls } = createFileSearch({ roots: ['file:///workspace'] });

        const matches = await search('a', 'file:///proj');

        expect(findCalls[0].rootUris).to.deep.equal(['file:///workspace']);
        expect(matches).to.have.length(1);
        expect(matches[0].path).to.equal('/root/proj/src/a.ts');
    });

    it('returns nothing without workspace roots or a fallback folder', async () => {
        const { search, findCalls } = createFileSearch({ roots: [] });

        expect(await search('a')).to.deep.equal([]);
        expect(findCalls).to.have.length(0);
    });
});
