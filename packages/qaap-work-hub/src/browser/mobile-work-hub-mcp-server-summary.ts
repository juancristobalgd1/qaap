// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { MCP_SERVERS_PREF } from '@theia/ai-mcp/lib/common/mcp-preferences';
import {
    loadMobileMcpAttachServerRows,
    MobileMcpAttachOptions,
    MobileMcpAttachServerRow,
    renderMobileMcpAttachSections,
} from '@theia/qaap-composer/lib/browser/qaap-mobile-mcp-attach-menu';

/**
 * The composer-identical "User" / "Plugins" server list rendered at the top of Settings → MCP.
 * It reads the same rows and runs the same enable action as the composer "+" MCP view; the
 * upstream MCP configuration widget below it keeps add, edit and delete.
 */
export class MobileWorkHubMcpServerSummary implements Disposable {

    readonly node: HTMLElement;

    protected rows: MobileMcpAttachServerRow[] = [];
    protected readonly toggling = new Set<string>();
    protected readonly toDispose: Disposable[] = [];

    constructor(protected readonly options: MobileMcpAttachOptions) {
        this.node = document.createElement('div');
        this.node.className = 'theia-mobile-work-hub-mcp-summary';
        const preferenceService = options.preferenceService;
        this.toDispose.push(preferenceService.onPreferenceChanged(event => {
            if (event.preferenceName === MCP_SERVERS_PREF && this.node.isConnected) {
                void this.refresh();
            }
        }));
    }

    /** Reloads the rows from the same sources as the composer and re-renders the list. */
    async refresh(): Promise<void> {
        this.rows = await loadMobileMcpAttachServerRows(this.options);
        this.render();
    }

    protected render(): void {
        this.node.replaceChildren();
        renderMobileMcpAttachSections(this.node, this.rows, {
            mcpOptions: this.options,
            toggling: this.toggling,
            rerender: () => this.render(),
            reload: () => this.refresh(),
        });
    }

    dispose(): void {
        this.toDispose.forEach(disposable => disposable.dispose());
        this.toDispose.length = 0;
        this.node.remove();
    }
}
