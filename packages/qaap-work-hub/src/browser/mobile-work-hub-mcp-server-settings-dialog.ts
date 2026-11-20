// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import {
    isLocalMCPServerDescription,
    isRemoteMCPServerDescription,
    MCPServerDescription,
} from '@theia/ai-mcp/lib/common/mcp-server-manager';
import {
    loadMobileMcpAttachServerRows,
    MobileMcpAttachOptions,
    MobileMcpAttachServerRow,
    toggleMobileMcpAttachServer,
} from '@theia/qaap-composer/lib/browser/qaap-mobile-mcp-attach-menu';
import { attachQaapScrollEdgeFades } from '@theia/qaap-mobile-shell/lib/browser/qaap-scroll-edge-fades';
import { isWorkHubTheiaDialogOpen } from '../common/qaap-work-hub-dialog-utils';

export interface MobileWorkHubMcpServerSettingsDialogOptions extends MobileMcpAttachOptions {
    /** Finds the upstream card of a server so Edit and Delete reuse its dialogs and confirmations. */
    readonly findUpstreamCard?: (slug: string) => HTMLElement | undefined;
    /** Runs after Start or Stop so the summary rows refresh. */
    readonly onChanged?: () => void | Promise<void>;
}

/** What the dialog shows for one server, loaded from the same sources as the summary rows. */
interface McpServerSettingsModel {
    readonly row: MobileMcpAttachServerRow;
    readonly description: MCPServerDescription | undefined;
    readonly canEdit: boolean;
    readonly canDelete: boolean;
}

/** Keys and a masked value only: environment values can hold secrets and are never shown. */
const MASKED_ENV_VALUE = '••••';

/**
 * Per-server settings sheet opened from the gear button of a Settings → MCP summary row.
 * It shows status, command, arguments, environment keys (values masked), autostart and tools,
 * and offers Start/Stop, Edit and Delete. Edit and Delete click the matching button of the hidden
 * upstream card so the upstream editor and confirmation dialogs keep working.
 */
export class MobileWorkHubMcpServerSettingsDialog implements Disposable {

    readonly node: HTMLElement;
    protected readonly titleEl: HTMLElement;
    protected readonly contentHost: HTMLElement;
    protected visible = false;
    protected slug: string | undefined;
    protected model: McpServerSettingsModel | undefined;
    protected loadToken = 0;
    protected busy = false;
    protected scrollFades: Disposable | undefined;

    protected readonly onKeyDown = (ev: KeyboardEvent): void => {
        if (ev.key === 'Escape' && this.visible) {
            if (isWorkHubTheiaDialogOpen()) {
                return;
            }
            ev.stopPropagation();
            this.hide();
        }
    };

    constructor(protected readonly options: MobileWorkHubMcpServerSettingsDialogOptions) {
        this.node = document.createElement('div');
        this.node.className = 'theia-mobile-work-hub-preferences theia-mobile-work-hub-mcp-server-dialog';
        this.node.setAttribute('role', 'dialog');
        this.node.setAttribute('aria-modal', 'true');
        this.node.setAttribute('aria-hidden', 'true');
        this.node.hidden = true;

        const backdrop = document.createElement('div');
        backdrop.className = 'theia-mobile-work-hub-preferences-backdrop';
        backdrop.addEventListener('click', () => this.hide());

        const sheet = document.createElement('section');
        sheet.className = 'theia-mobile-work-hub-preferences-sheet';

        const header = document.createElement('header');
        header.className = 'theia-mobile-work-hub-preferences-header';

        this.titleEl = document.createElement('h2');
        this.titleEl.className = 'theia-mobile-work-hub-preferences-title';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'theia-mobile-work-hub-preferences-close codicon codicon-close';
        closeBtn.title = nls.localize('qaap/mcpSettings/close', 'Close');
        closeBtn.setAttribute('aria-label', closeBtn.title);
        closeBtn.addEventListener('click', () => this.hide());

        header.append(this.titleEl, closeBtn);

        this.contentHost = document.createElement('div');
        this.contentHost.className = 'theia-mobile-work-hub-mcp-server-dialog-scroll';
        this.contentHost.setAttribute('role', 'region');

        sheet.append(header, this.contentHost);
        this.node.append(backdrop, sheet);
    }

    isVisible(): boolean {
        return this.visible;
    }

    /** Opens the settings of one server and loads its current status and configuration. */
    async show(slug: string): Promise<void> {
        this.slug = slug;
        if (!this.node.isConnected) {
            document.body.append(this.node);
        }
        this.node.hidden = false;
        this.node.classList.add('theia-mod-visible');
        this.node.setAttribute('aria-hidden', 'false');
        this.visible = true;
        document.addEventListener('keydown', this.onKeyDown, true);
        this.scrollFades?.dispose();
        this.scrollFades = attachQaapScrollEdgeFades(this.contentHost);
        await this.load();
    }

    hide(): void {
        if (!this.visible) {
            return;
        }
        this.loadToken += 1;
        this.node.classList.remove('theia-mod-visible');
        this.node.hidden = true;
        this.node.setAttribute('aria-hidden', 'true');
        this.visible = false;
        this.scrollFades?.dispose();
        this.scrollFades = undefined;
        document.removeEventListener('keydown', this.onKeyDown, true);
    }

    dispose(): void {
        this.hide();
        this.node.remove();
    }

    protected async load(): Promise<void> {
        const slug = this.slug;
        if (slug === undefined) {
            return;
        }
        const token = ++this.loadToken;
        const rows = await loadMobileMcpAttachServerRows(this.options);
        const description = await this.options.mcpFrontendService?.getServerDescription(slug);
        if (!this.visible || token !== this.loadToken || this.slug !== slug) {
            return;
        }
        const row = rows.find(candidate => candidate.slug === slug);
        const upstreamCard = this.options.findUpstreamCard?.(slug);
        this.model = row ? {
            row,
            description,
            canEdit: !!upstreamCard?.querySelector('.mcp-action-button.codicon-edit'),
            canDelete: !!upstreamCard?.querySelector('.mcp-action-button.mcp-delete-button'),
        } : undefined;
        this.paint();
    }

    protected paint(): void {
        this.contentHost.replaceChildren();
        const model = this.model;
        if (!model) {
            this.titleEl.textContent = this.slug ?? '';
            this.contentHost.append(this.createParagraph(
                nls.localize('qaap/mcpSettings/unavailable', 'Server settings are unavailable.'),
            ));
            return;
        }
        this.titleEl.textContent = model.row.label;
        this.contentHost.append(
            this.createStatusSection(model),
            this.createConfigSection(model.description),
            this.createToolsSection(model.description),
            this.createActionsSection(model),
        );
    }

    protected createStatusSection(model: McpServerSettingsModel): HTMLElement {
        const section = this.createSection(nls.localize('qaap/mcpSettings/status', 'Status'));
        const badge = document.createElement('span');
        badge.className = 'theia-mobile-work-hub-mcp-server-dialog-badge';
        if (model.row.errored) {
            badge.classList.add('theia-mod-errored');
        } else if (model.row.running) {
            badge.classList.add('theia-mod-running');
        }
        badge.textContent = model.description?.status
            ?? (model.row.running
                ? nls.localize('qaap/mcpSettings/running', 'Running')
                : nls.localize('qaap/mcpSettings/notRunning', 'Not running'));
        section.append(badge);

        if (model.row.errored && model.row.statusMessage) {
            const error = document.createElement('p');
            error.className = 'theia-mobile-work-hub-mcp-server-dialog-error';
            error.textContent = model.row.statusMessage;
            section.append(error);
        }
        return section;
    }

    protected createConfigSection(description: MCPServerDescription | undefined): HTMLElement {
        const section = this.createSection(nls.localize('qaap/mcpSettings/configuration', 'Configuration'));
        if (!description) {
            section.append(this.createParagraph(nls.localize('qaap/mcpSettings/noConfiguration', 'No configuration available.')));
            return section;
        }

        const list = document.createElement('dl');
        list.className = 'theia-mobile-work-hub-mcp-server-dialog-facts';
        if (isLocalMCPServerDescription(description)) {
            list.append(
                this.createFact(nls.localize('qaap/mcpSettings/command', 'Command'), this.createCode(description.command)),
                this.createFact(
                    nls.localize('qaap/mcpSettings/arguments', 'Arguments'),
                    this.createCode((description.args ?? []).join(' ')),
                ),
                this.createFact(nls.localize('qaap/mcpSettings/environment', 'Environment variables'), this.createEnvList(description.env)),
            );
        } else if (isRemoteMCPServerDescription(description)) {
            list.append(this.createFact(nls.localize('qaap/mcpSettings/serverUrl', 'Server URL'), this.createCode(description.serverUrl)));
        }
        list.append(this.createFact(
            nls.localize('qaap/mcpSettings/autostart', 'Autostart'),
            this.createText(description.autostart
                ? nls.localize('qaap/mcpSettings/enabled', 'Enabled')
                : nls.localize('qaap/mcpSettings/disabled', 'Disabled')),
        ));
        section.append(list);
        return section;
    }

    protected createToolsSection(description: MCPServerDescription | undefined): HTMLElement {
        const tools = description?.tools ?? [];
        const section = this.createSection(nls.localize('qaap/mcpSettings/tools', 'Tools ({0})', tools.length));
        if (tools.length === 0) {
            section.append(this.createParagraph(nls.localize('qaap/mcpSettings/noTools', 'No tools reported.')));
            return section;
        }
        const list = document.createElement('ul');
        list.className = 'theia-mobile-work-hub-mcp-server-dialog-tools';
        for (const tool of tools) {
            const item = document.createElement('li');
            const name = document.createElement('strong');
            name.textContent = tool.name;
            item.append(name);
            if (tool.description) {
                const detail = document.createElement('span');
                detail.textContent = tool.description;
                item.append(detail);
            }
            list.append(item);
        }
        section.append(list);
        return section;
    }

    protected createActionsSection(model: McpServerSettingsModel): HTMLElement {
        const actions = document.createElement('div');
        actions.className = 'theia-mobile-work-hub-mcp-server-dialog-actions';

        const toggle = this.createButton(
            model.row.running ? nls.localize('qaap/mcpSettings/stop', 'Stop') : nls.localize('qaap/mcpSettings/start', 'Start'),
            'theia-button main',
            () => void this.toggleServer(model.row),
        );
        toggle.disabled = this.busy || !this.options.mcpFrontendService;
        actions.append(toggle);

        if (model.canEdit) {
            actions.append(this.createButton(
                nls.localize('qaap/mcpSettings/edit', 'Edit'),
                'theia-button secondary',
                () => this.triggerUpstreamAction('.mcp-action-button.codicon-edit'),
            ));
        }
        const tools = model.description?.tools ?? [];
        if (tools.length > 0) {
            actions.append(this.createButton(
                nls.localize('qaap/mcpSettings/copyTools', 'Copy tools'),
                'theia-button secondary',
                () => this.copyTools(model.row.slug, tools.map(tool => tool.name)),
            ));
        }
        if (model.canDelete) {
            actions.append(this.createButton(
                nls.localize('qaap/mcpSettings/delete', 'Delete'),
                'theia-button secondary theia-mobile-work-hub-mcp-server-dialog-danger',
                () => this.triggerUpstreamAction('.mcp-action-button.mcp-delete-button'),
            ));
        }
        return actions;
    }

    protected async toggleServer(row: MobileMcpAttachServerRow): Promise<void> {
        const service = this.options.mcpFrontendService;
        if (!service || this.busy) {
            return;
        }
        this.busy = true;
        this.paint();
        try {
            await toggleMobileMcpAttachServer(service, row);
        } catch {
            // The refreshed status below shows the outcome; a failed start stays Errored.
        }
        this.busy = false;
        await this.options.onChanged?.();
        await this.load();
    }

    /** Clicks the hidden upstream card button so the upstream edit or delete flow runs unchanged. */
    protected triggerUpstreamAction(selector: string): void {
        const slug = this.slug;
        const button = slug === undefined
            ? undefined
            : this.options.findUpstreamCard?.(slug)?.querySelector<HTMLButtonElement>(selector);
        if (!button) {
            return;
        }
        this.hide();
        button.click();
    }

    protected copyTools(slug: string, toolNames: string[]): void {
        // Same prompt-reference format as the upstream "Copy all (list of all tools)" action.
        const text = toolNames.map(name => `~{mcp_${slug}_${name}}`).join('\n');
        void navigator.clipboard?.writeText(text).catch(() => undefined);
    }

    protected createSection(title: string): HTMLElement {
        const section = document.createElement('section');
        section.className = 'theia-mobile-work-hub-mcp-server-dialog-section';
        const heading = document.createElement('h3');
        heading.className = 'theia-mobile-work-hub-mcp-server-dialog-heading';
        heading.textContent = title;
        section.append(heading);
        return section;
    }

    protected createFact(label: string, value: HTMLElement): HTMLElement {
        const row = document.createElement('div');
        row.className = 'theia-mobile-work-hub-mcp-server-dialog-fact';
        const term = document.createElement('dt');
        term.textContent = label;
        const detail = document.createElement('dd');
        detail.append(value);
        row.append(term, detail);
        return row;
    }

    protected createEnvList(env: Record<string, string> | undefined): HTMLElement {
        const entries = Object.keys(env ?? {});
        if (entries.length === 0) {
            return this.createText(nls.localize('qaap/mcpSettings/none', 'None'));
        }
        const list = document.createElement('div');
        list.className = 'theia-mobile-work-hub-mcp-server-dialog-env';
        for (const key of entries) {
            const entry = document.createElement('div');
            const name = this.createCode(key);
            const masked = document.createElement('span');
            masked.className = 'theia-mobile-work-hub-mcp-server-dialog-masked';
            masked.textContent = MASKED_ENV_VALUE;
            entry.append(name, ' = ', masked);
            list.append(entry);
        }
        return list;
    }

    protected createCode(text: string): HTMLElement {
        return this.createText(text, 'code');
    }

    protected createText(text: string, tagName: 'span' | 'code' = 'span'): HTMLElement {
        const element = document.createElement(tagName);
        element.textContent = text || nls.localize('qaap/mcpSettings/none', 'None');
        return element;
    }

    protected createParagraph(text: string): HTMLElement {
        const paragraph = document.createElement('p');
        paragraph.className = 'theia-mobile-work-hub-mcp-server-dialog-note';
        paragraph.textContent = text;
        return paragraph;
    }

    protected createButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', ev => {
            ev.stopPropagation();
            onClick();
        });
        return button;
    }
}
