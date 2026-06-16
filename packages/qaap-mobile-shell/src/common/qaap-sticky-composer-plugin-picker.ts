// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapMcpMarketplacePlugin } from './qaap-mcp-plugin-marketplace-catalog';
import { createMcpPluginIconElement } from './qaap-mcp-plugin-icons';
import { resolveMcpMarketplacePlugin } from './qaap-mcp-plugin-install';

export type StickyComposerPluginPickerMode = 'add-plugin' | 'remove-plugin';

export interface RenderStickyComposerAddPluginPickerOptions {
    readonly list: HTMLElement;
    readonly plugins: readonly QaapMcpMarketplacePlugin[];
    readonly onBack: () => void;
    readonly onSelectPlugin: (plugin: QaapMcpMarketplacePlugin) => void;
    readonly onBrowseMarketplace: () => void;
    readonly onPickStart: () => void;
}

export interface RenderStickyComposerRemovePluginPickerOptions {
    readonly list: HTMLElement;
    readonly installedSlugs: readonly string[];
    readonly onBack: () => void;
    readonly onRemoveSlug: (slug: string) => void;
    readonly onPickStart: () => void;
}

function createPluginIcon(plugin: QaapMcpMarketplacePlugin): HTMLElement {
    return createMcpPluginIconElement(
        plugin.slug,
        'theia-mobile-projects-sticky-composer-plugin-picker-icon',
        { letter: plugin.iconLetter, color: plugin.iconColor },
    );
}

function appendPickerHeader(list: HTMLElement, title: string, onBack: () => void): void {
    const header = document.createElement('div');
    header.className = 'theia-mobile-projects-sticky-composer-plugin-picker-header';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'theia-mobile-projects-sticky-composer-plugin-picker-back';
    backBtn.title = nls.localize('qaap/mobileProjects/slashPluginPickerBack', 'Back');
    backBtn.setAttribute('aria-label', backBtn.title);
    backBtn.innerHTML = '<span class="codicon codicon-arrow-left" aria-hidden="true"></span>';
    backBtn.addEventListener('mousedown', ev => ev.preventDefault());
    backBtn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        onBack();
    });

    const heading = document.createElement('div');
    heading.className = 'theia-mobile-projects-sticky-composer-plugin-picker-title';
    heading.textContent = title;

    header.append(backBtn, heading);
    list.append(header);
}

export function renderStickyComposerAddPluginPicker(options: RenderStickyComposerAddPluginPickerOptions): number {
    const { list, plugins, onBack, onSelectPlugin, onBrowseMarketplace, onPickStart } = options;
    list.replaceChildren();
    list.className = 'theia-mobile-projects-sticky-composer-plugin-picker-list';

    appendPickerHeader(
        list,
        nls.localize('qaap/mobileProjects/slashPluginPickerAddTitle', 'Add Plugin'),
        onBack,
    );

    const body = document.createElement('div');
    body.className = 'theia-mobile-projects-sticky-composer-plugin-picker-body';

    if (plugins.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'theia-mobile-projects-sticky-composer-plugin-picker-empty';
        empty.textContent = nls.localize(
            'qaap/mobileProjects/slashPluginPickerNoPlugins',
            'No plugins match your search.',
        );
        body.append(empty);
    }

    for (const plugin of plugins) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-mobile-projects-sticky-composer-plugin-picker-option';
        btn.setAttribute('role', 'option');
        btn.dataset.pluginId = plugin.id;

        const icon = createPluginIcon(plugin);

        const text = document.createElement('span');
        text.className = 'theia-mobile-projects-sticky-composer-plugin-picker-option-text';

        const titleRow = document.createElement('span');
        titleRow.className = 'theia-mobile-projects-sticky-composer-plugin-picker-option-title-row';

        const name = document.createElement('span');
        name.className = 'theia-mobile-projects-sticky-composer-plugin-picker-option-name';
        name.textContent = plugin.name;

        const slug = document.createElement('span');
        slug.className = 'theia-mobile-projects-sticky-composer-plugin-picker-option-slug';
        slug.textContent = plugin.slug;

        titleRow.append(name, slug);

        const description = document.createElement('span');
        description.className = 'theia-mobile-projects-sticky-composer-plugin-picker-option-description';
        description.textContent = plugin.description;

        text.append(titleRow, description);

        const enterHint = document.createElement('span');
        enterHint.className = 'theia-mobile-projects-sticky-composer-plugin-picker-enter-hint';
        enterHint.setAttribute('aria-hidden', 'true');
        enterHint.textContent = '↵';

        btn.append(icon, text, enterHint);

        btn.addEventListener('mousedown', ev => {
            ev.preventDefault();
            onPickStart();
        });
        btn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            onSelectPlugin(plugin);
        });
        body.append(btn);
    }

    list.append(body);

    const footer = document.createElement('div');
    footer.className = 'theia-mobile-projects-sticky-composer-plugin-picker-footer';

    const browseBtn = document.createElement('button');
    browseBtn.type = 'button';
    browseBtn.className = 'theia-mobile-projects-sticky-composer-plugin-picker-browse';
    browseBtn.textContent = nls.localize('qaap/mobileProjects/slashPluginPickerBrowse', 'Browse Marketplace');
    browseBtn.addEventListener('mousedown', ev => ev.preventDefault());
    browseBtn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        onBrowseMarketplace();
    });
    footer.append(browseBtn);
    list.append(footer);

    return plugins.length;
}

export function renderStickyComposerRemovePluginPicker(options: RenderStickyComposerRemovePluginPickerOptions): number {
    const { list, installedSlugs, onBack, onRemoveSlug, onPickStart } = options;
    list.replaceChildren();
    list.className = 'theia-mobile-projects-sticky-composer-plugin-picker-list';

    appendPickerHeader(
        list,
        nls.localize('qaap/mobileProjects/slashPluginPickerRemoveTitle', 'Remove Plugin'),
        onBack,
    );

    const body = document.createElement('div');
    body.className = 'theia-mobile-projects-sticky-composer-plugin-picker-body';

    if (installedSlugs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'theia-mobile-projects-sticky-composer-plugin-picker-empty';
        empty.textContent = nls.localize(
            'qaap/mobileProjects/slashPluginPickerNoInstalled',
            'No MCP plugins are installed yet.',
        );
        body.append(empty);
    }

    for (const slug of installedSlugs) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-mobile-projects-sticky-composer-plugin-picker-option theia-mod-remove';
        btn.setAttribute('role', 'option');
        btn.dataset.pluginSlug = slug;

        const catalog = resolveMcpMarketplacePlugin(slug);
        const icon = createMcpPluginIconElement(
            slug,
            'theia-mobile-projects-sticky-composer-plugin-picker-icon',
            {
                letter: catalog?.iconLetter ?? slug.charAt(0).toUpperCase(),
                color: catalog?.iconColor,
            },
        );

        const text = document.createElement('span');
        text.className = 'theia-mobile-projects-sticky-composer-plugin-picker-option-text';

        const titleRow = document.createElement('span');
        titleRow.className = 'theia-mobile-projects-sticky-composer-plugin-picker-option-title-row';

        const name = document.createElement('span');
        name.className = 'theia-mobile-projects-sticky-composer-plugin-picker-option-name';
        name.textContent = slug;

        titleRow.append(name);

        const description = document.createElement('span');
        description.className = 'theia-mobile-projects-sticky-composer-plugin-picker-option-description';
        description.textContent = nls.localize(
            'qaap/mobileProjects/slashPluginPickerRemoveHint',
            'Tap to remove this MCP server',
        );

        text.append(titleRow, description);
        btn.append(icon, text);

        btn.addEventListener('mousedown', ev => {
            ev.preventDefault();
            onPickStart();
        });
        btn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            onRemoveSlug(slug);
        });
        body.append(btn);
    }

    list.append(body);
    return installedSlugs.length;
}
