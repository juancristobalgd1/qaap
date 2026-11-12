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
import {
    MobileWorkHubMcpServerSettingsDialog,
} from './mobile-work-hub-mcp-server-settings-dialog';

export interface MobileWorkHubMcpServerSummaryOptions extends MobileMcpAttachOptions {
    /** Finds the hidden upstream card of a server; forwarded to the per-server settings dialog. */
    readonly findUpstreamCard?: (slug: string) => HTMLElement | undefined;
}

/**
 * The composer-identical "User" / "Plugins" server list rendered at the top of Settings → MCP.
 * It reads the same rows and runs the same enable action as the composer "+" MCP view. Each row
 * has a settings button that opens the per-server dialog; the upstream MCP configuration widget
 * below it keeps the add-server area.
 */
export class MobileWorkHubMcpServerSummary implements Disposable {

    readonly node: HTMLElement;

    protected rows: MobileMcpAttachServerRow[] = [];
    protected readonly toggling = new Set<string>();
    protected readonly toDispose: Disposable[] = [];
    protected readonly settingsDialog: MobileWorkHubMcpServerSettingsDialog;

    constructor(protected readonly options: MobileWorkHubMcpServerSummaryOptions) {
        this.node = document.createElement('div');
        this.node.className = 'theia-mobile-work-hub-mcp-summary';
        this.settingsDialog = new MobileWorkHubMcpServerSettingsDialog({
            ...options,
            onChanged: () => this.refresh(),
        });
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
            onOpenSettings: row => void this.settingsDialog.show(row.slug),
        });
    }

    dispose(): void {
        this.toDispose.forEach(disposable => disposable.dispose());
        this.toDispose.length = 0;
        this.settingsDialog.dispose();
        this.node.remove();
    }
}
