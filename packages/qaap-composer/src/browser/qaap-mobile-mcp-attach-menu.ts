// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { MCPFrontendService, MCPServerStatus } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import {
    QAAP_MCP_MARKETPLACE_PLUGINS,
} from '../common/qaap-mcp-plugin-marketplace-catalog';
import {
    readInstalledMcpServerSlugs,
    resolveMcpMarketplacePlugin,
} from '../common/qaap-mcp-plugin-install';
import { createMcpPluginIconElement } from '../common/qaap-mcp-plugin-icons';

export interface MobileMcpAttachOptions {
    readonly preferenceService: PreferenceService;
    readonly mcpFrontendService?: MCPFrontendService;
    readonly openMcpSettings?: () => void | Promise<void>;
}

export interface MobileMcpAttachServerRow {
    readonly slug: string;
    readonly label: string;
    readonly iconLetter: string;
    readonly iconColor?: string;
    readonly running: boolean;
    readonly errored: boolean;
    readonly statusHint?: string;
    readonly isMarketplacePlugin: boolean;
}

export async function loadMobileMcpAttachServerRows(
    options: MobileMcpAttachOptions,
): Promise<MobileMcpAttachServerRow[]> {
    const slugs = [...readInstalledMcpServerSlugs(options.preferenceService)].sort();
    const started = new Set(await options.mcpFrontendService?.getStartedServers() ?? []);
    const rows: MobileMcpAttachServerRow[] = [];
    for (const slug of slugs) {
        const catalog = resolveMcpMarketplacePlugin(slug);
        const description = await options.mcpFrontendService?.getServerDescription(slug);
        const errored = description?.status === MCPServerStatus.Errored;
        rows.push({
            slug,
            label: catalog?.name ?? slug,
            iconLetter: catalog?.iconLetter ?? slug.charAt(0).toUpperCase(),
            iconColor: catalog?.iconColor,
            running: started.has(slug),
            errored,
            statusHint: errored
                ? nls.localize('qaap/mobileProjects/mcpAttachErrored', 'Errored')
                : undefined,
            isMarketplacePlugin: !!catalog || QAAP_MCP_MARKETPLACE_PLUGINS.some(plugin => plugin.slug === slug),
        });
    }
    return rows;
}

function filterMcpAttachRows(
    rows: readonly MobileMcpAttachServerRow[],
    query: string,
): MobileMcpAttachServerRow[] {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return [...rows];
    }
    return rows.filter(row =>
        row.slug.toLowerCase().includes(needle)
        || row.label.toLowerCase().includes(needle),
    );
}

function createMcpServerIcon(row: MobileMcpAttachServerRow): HTMLElement {
    const icon = createMcpPluginIconElement(row.slug, 'theia-mobile-mcp-attach-server-icon', {
        letter: row.iconLetter,
        color: row.iconColor,
    });

    const status = document.createElement('span');
    status.className = 'theia-mobile-mcp-attach-server-status';
    if (row.errored) {
        status.classList.add('theia-mod-errored');
    } else if (row.running) {
        status.classList.add('theia-mod-running');
    }
    status.setAttribute('aria-hidden', 'true');
    icon.append(status);
    return icon;
}

function createMcpToggle(
    running: boolean,
    disabled: boolean,
    onToggle: () => void,
): HTMLButtonElement {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'theia-mobile-mcp-attach-toggle';
    toggle.classList.toggle('theia-mod-on', running);
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', running ? 'true' : 'false');
    toggle.disabled = disabled;
    toggle.title = running
        ? nls.localize('qaap/mobileProjects/mcpAttachDisable', 'Disable MCP server')
        : nls.localize('qaap/mobileProjects/mcpAttachEnable', 'Enable MCP server');
    toggle.addEventListener('click', ev => {
        ev.stopPropagation();
        onToggle();
    });
    return toggle;
}

export interface RenderMobileMcpAttachViewOptions {
    readonly menuBody: HTMLElement;
    readonly mcpOptions: MobileMcpAttachOptions;
    readonly onBack: () => void;
    readonly onCloseMenu: () => void;
}

export function renderMobileMcpAttachView(options: RenderMobileMcpAttachViewOptions): void {
    const { menuBody, mcpOptions, onBack, onCloseMenu } = options;
    menuBody.replaceChildren();

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'theia-mobile-projects-sticky-composer-attach-menu-back';
    back.setAttribute('role', 'menuitem');
    const backIcon = document.createElement('span');
    backIcon.className = 'codicon codicon-arrow-left';
    backIcon.setAttribute('aria-hidden', 'true');
    const backLabel = document.createElement('span');
    backLabel.textContent = nls.localize('qaap/mobileProjects/stickyComposerAttachBack', 'Back');
    back.append(backIcon, backLabel);
    back.addEventListener('click', ev => {
        ev.stopPropagation();
        onBack();
    });
    menuBody.append(back);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'theia-mobile-mcp-attach-search';
    search.placeholder = nls.localize('qaap/mobileProjects/mcpAttachSearch', 'Search MCP servers…');
    search.setAttribute('aria-label', search.placeholder);
    menuBody.append(search);

    const scroll = document.createElement('div');
    scroll.className = 'theia-mobile-mcp-attach-scroll';
    menuBody.append(scroll);

    const footer = document.createElement('div');
    footer.className = 'theia-mobile-mcp-attach-footer';
    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'theia-mobile-mcp-attach-settings';
    settingsBtn.textContent = nls.localize('qaap/mobileProjects/mcpAttachOpenSettings', 'Open MCP Settings');
    settingsBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        onCloseMenu();
        void mcpOptions.openMcpSettings?.();
    });
    footer.append(settingsBtn);
    menuBody.append(footer);

    let rows: MobileMcpAttachServerRow[] = [];
    let filterQuery = '';
    const toggling = new Set<string>();

    const renderRows = (): void => {
        scroll.replaceChildren();
        const filtered = filterMcpAttachRows(rows, filterQuery);
        const userRows = filtered.filter(row => !row.isMarketplacePlugin);
        const pluginRows = filtered.filter(row => row.isMarketplacePlugin);

        const appendSection = (title: string, sectionRows: readonly MobileMcpAttachServerRow[]): void => {
            if (sectionRows.length === 0) {
                return;
            }
            const heading = document.createElement('div');
            heading.className = 'theia-mobile-mcp-attach-section-title';
            heading.textContent = title;
            scroll.append(heading);

            for (const row of sectionRows) {
                const item = document.createElement('div');
                item.className = 'theia-mobile-mcp-attach-server-row';
                item.setAttribute('role', 'menuitem');

                const icon = createMcpServerIcon(row);
                const text = document.createElement('span');
                text.className = 'theia-mobile-mcp-attach-server-text';

                const name = document.createElement('span');
                name.className = 'theia-mobile-mcp-attach-server-name';
                name.textContent = row.label;
                text.append(name);

                if (row.statusHint) {
                    const hint = document.createElement('span');
                    hint.className = 'theia-mobile-mcp-attach-server-hint theia-mod-errored';
                    hint.textContent = row.statusHint;
                    text.append(hint);
                }

                const toggle = createMcpToggle(
                    row.running,
                    !mcpOptions.mcpFrontendService || toggling.has(row.slug),
                    () => {
                        if (!mcpOptions.mcpFrontendService || toggling.has(row.slug)) {
                            return;
                        }
                        toggling.add(row.slug);
                        renderRows();
                        const action = row.running
                            ? mcpOptions.mcpFrontendService.stopServer(row.slug)
                            : mcpOptions.mcpFrontendService.startServer(row.slug);
                        void action
                            .catch(() => undefined)
                            .finally(async () => {
                                toggling.delete(row.slug);
                                rows = await loadMobileMcpAttachServerRows(mcpOptions);
                                renderRows();
                            });
                    },
                );

                item.append(icon, text, toggle);
                scroll.append(item);
            }
        };

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'theia-mobile-projects-sticky-composer-attach-menu-empty';
            empty.textContent = rows.length === 0
                ? nls.localize('qaap/mobileProjects/mcpAttachEmpty', 'No MCP servers configured yet.')
                : nls.localize('qaap/mobileProjects/mcpAttachNoMatch', 'No MCP servers match your search.');
            scroll.append(empty);
            return;
        }

        appendSection(
            nls.localize('qaap/mobileProjects/mcpAttachUserSection', 'User'),
            userRows,
        );
        appendSection(
            nls.localize('qaap/mobileProjects/mcpAttachPluginsSection', 'Plugins'),
            pluginRows,
        );
    };

    search.addEventListener('input', () => {
        filterQuery = search.value;
        renderRows();
    });

    void loadMobileMcpAttachServerRows(mcpOptions).then(loaded => {
        rows = loaded;
        renderRows();
        search.focus();
    });
}
