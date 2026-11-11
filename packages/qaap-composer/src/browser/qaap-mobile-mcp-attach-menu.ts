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
    /** Server error message, shown as the tooltip of the errored hint. */
    readonly statusMessage?: string;
    readonly isMarketplacePlugin: boolean;
}

/**
 * Single source of truth for the MCP server list shown by the composer "+" menu and by
 * Settings → MCP: the installed server preference, enriched with live status from the manager.
 */
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
            statusMessage: errored ? description?.error : undefined,
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

/** Splits rows into the "User" and "Plugins" sections shared by the composer and Settings → MCP. */
export function groupMobileMcpAttachRows(rows: readonly MobileMcpAttachServerRow[]): {
    userRows: MobileMcpAttachServerRow[];
    pluginRows: MobileMcpAttachServerRow[];
} {
    return {
        userRows: rows.filter(row => !row.isMarketplacePlugin),
        pluginRows: rows.filter(row => row.isMarketplacePlugin),
    };
}

/** The enable/disable action for a server row; the composer and Settings → MCP both use it. */
export async function toggleMobileMcpAttachServer(
    mcpFrontendService: MCPFrontendService,
    row: MobileMcpAttachServerRow,
): Promise<void> {
    if (row.running) {
        await mcpFrontendService.stopServer(row.slug);
    } else {
        await mcpFrontendService.startServer(row.slug);
    }
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

export interface MobileMcpAttachRowElementOptions {
    readonly toggleDisabled: boolean;
    readonly onToggle: () => void;
}

/** One server row: icon with status dot, name, optional error hint and the enable switch. */
export function createMobileMcpAttachRowElement(
    row: MobileMcpAttachServerRow,
    options: MobileMcpAttachRowElementOptions,
): HTMLElement {
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
        if (row.statusMessage) {
            hint.title = row.statusMessage;
        }
        text.append(hint);
    }

    const toggle = createMcpToggle(row.running, options.toggleDisabled, options.onToggle);
    item.append(icon, text, toggle);
    return item;
}

export interface MobileMcpAttachSectionsOptions {
    readonly mcpOptions: MobileMcpAttachOptions;
    /** Slugs whose toggle is in flight; their switch is disabled until the action settles. */
    readonly toggling: Set<string>;
    /** Re-renders the sections, e.g. when a toggle starts. */
    readonly rerender: () => void;
    /** Reloads the rows once a toggle settled. */
    readonly reload: () => Promise<void>;
}

/** Appends the "User" and "Plugins" sections with live enable switches into `container`. */
export function renderMobileMcpAttachSections(
    container: HTMLElement,
    rows: readonly MobileMcpAttachServerRow[],
    options: MobileMcpAttachSectionsOptions,
): void {
    const { userRows, pluginRows } = groupMobileMcpAttachRows(rows);

    const appendSection = (title: string, sectionRows: readonly MobileMcpAttachServerRow[]): void => {
        if (sectionRows.length === 0) {
            return;
        }
        const heading = document.createElement('div');
        heading.className = 'theia-mobile-mcp-attach-section-title';
        heading.textContent = title;
        container.append(heading);

        for (const row of sectionRows) {
            const service = options.mcpOptions.mcpFrontendService;
            const item = createMobileMcpAttachRowElement(row, {
                toggleDisabled: !service || options.toggling.has(row.slug),
                onToggle: () => {
                    if (!service || options.toggling.has(row.slug)) {
                        return;
                    }
                    options.toggling.add(row.slug);
                    options.rerender();
                    void toggleMobileMcpAttachServer(service, row)
                        .catch(() => undefined)
                        .finally(async () => {
                            options.toggling.delete(row.slug);
                            await options.reload();
                        });
                },
            });
            container.append(item);
        }
    };

    appendSection(nls.localize('qaap/mobileProjects/mcpAttachUserSection', 'User'), userRows);
    appendSection(nls.localize('qaap/mobileProjects/mcpAttachPluginsSection', 'Plugins'), pluginRows);
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

    const reload = async (): Promise<void> => {
        rows = await loadMobileMcpAttachServerRows(mcpOptions);
        renderRows();
    };

    const renderRows = (): void => {
        scroll.replaceChildren();
        const filtered = filterMcpAttachRows(rows, filterQuery);

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'theia-mobile-projects-sticky-composer-attach-menu-empty';
            empty.textContent = rows.length === 0
                ? nls.localize('qaap/mobileProjects/mcpAttachEmpty', 'No MCP servers configured yet.')
                : nls.localize('qaap/mobileProjects/mcpAttachNoMatch', 'No MCP servers match your search.');
            scroll.append(empty);
            return;
        }

        renderMobileMcpAttachSections(scroll, filtered, {
            mcpOptions,
            toggling,
            rerender: renderRows,
            reload,
        });
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
