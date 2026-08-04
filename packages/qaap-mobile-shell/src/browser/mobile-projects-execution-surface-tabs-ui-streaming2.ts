// @ts-nocheck
// Extracted from mobile-projects-execution-surface-tabs-ui.ts

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import {
    type ExecutionSurfaceTabId,
    recordExecutionSurfaceTabUse,
} from '../common/qaap-execution-surface-tabs';
import {
    appendExecutionSurfaceTabIcon,
    createExecutionSurfaceIconElement,
    isExecutionSurfaceIconElement,
    QAAP_MESSAGE_CIRCLE_ICON_CLASS,
    QAAP_SCM_CHANGES_ICON_CLASS,
} from '../common/qaap-scm-changes-icon';
import { applyExecutionSurfaceHeaderChrome, queryExecutionSurfaceViewSelect } from './qaap-execution-surface-header-chrome';
import { appendAgentBrandIcon, createAgentBrandIcon } from '../common/qaap-agent-branding';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';
import { resolveInteractiveAgentCliBin } from '../common/qaap-agent-tui-command';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsProjectDetailUi } from './mobile-projects-project-detail-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import type { MobileProjectsTranscriptSurfacesUi } from './mobile-projects-transcript-surfaces-ui';

export function applyExecutionSurfaceIconSelectDisplayExtracted(ctx: any, strip: HTMLElement, activeTab: TranscriptTab): void {
    const selectBtn = queryExecutionSurfaceViewSelect(strip);
    const symbol = selectBtn?.querySelector<HTMLElement>('.theia-mobile-transcript-tab-icon-select-symbol');
    if (!selectBtn || !symbol) {
        return;
    }
    const displayTabId = ctx.resolveExecutionSurfaceIconSelectDisplayTab(activeTab);
    const spec = ctx.executionSurfaceTabSpecs().find(entry => entry.id === displayTabId)
        ?? (displayTabId === 'messages'
            ? { id: 'messages' as TranscriptTab, label: nls.localize('qaap/mobileProjects/tabChat', 'Chat'), icon: QAAP_MESSAGE_CIRCLE_ICON_CLASS }
            : undefined);
    if (!spec) {
        return;
    }
    selectBtn.dataset.tab = spec.id;
    selectBtn.title = spec.label;
    selectBtn.setAttribute('aria-label', `${spec.label}, ${nls.localize('qaap/mobileProjects/tabOverflow', 'Change view')}`);
    const iconUnchanged = isExecutionSurfaceIconElement(symbol, spec.icon);
    if (!iconUnchanged) {
        symbol.replaceWith(createExecutionSurfaceIconElement(spec.icon, 'theia-mobile-transcript-tab-icon-select-symbol'));
    }
    const triggerLabel = selectBtn.querySelector<HTMLElement>('.theia-mobile-transcript-tab-icon-select-label');
    if (triggerLabel) {
        triggerLabel.textContent = spec.label;
    }
    for (const item of Array.from(strip.querySelectorAll<HTMLButtonElement>('.theia-mobile-transcript-tab-icon-select-option'))) {
        const tabId = item.dataset.tab as TranscriptTab | undefined;
        item.classList.toggle('theia-mod-active', tabId === activeTab);
    }
}

export function buildTranscriptTabStripExtracted(ctx: any, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): HTMLElement {
    return ctx.buildExecutionViewTabStrip(
        ctx.executionSurfaceTabForProject(project),
        tab => ctx.selectTranscriptTab(tab, project, summary),
    );
}

export function buildExecutionViewTabStripExtracted(ctx: any, activeTab: TranscriptTab,
    onSelect: (tab: TranscriptTab) => void,): HTMLElement {
    const strip = document.createElement('div');
    strip.className = 'theia-mobile-transcript-tabs theia-mod-header-inline';
    strip.setAttribute('role', 'tablist');
    const tabSpecs = ctx.executionSurfaceTabSpecs();
    const selectTab = (tab: TranscriptTab): void => {
        ctx.closeExecutionTabOverflowMenu();
        onSelect(tab);
    };
    const displayTabId = ctx.resolveExecutionSurfaceIconSelectDisplayTab(activeTab);
    if (activeTab === 'terminal') {
        strip.append(ctx.createTerminalAgentTuiSelect());
    }
    strip.append(ctx.createExecutionSurfaceIconSelect(
        displayTabId,
        activeTab,
        tabSpecs,
        selectTab,
    ));
    applyExecutionSurfaceHeaderChrome(strip, activeTab);
    return strip;
}

export function createTerminalAgentTuiSelectExtracted(ctx: any): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'theia-mobile-transcript-tab-icon-select-host theia-mobile-transcript-terminal-agent-tui-host';

    const menuLabel = nls.localize('qaap/mobileProjects/terminalAgentTui', 'Open agent TUI');
    const menu = document.createElement('div');
    menu.className = 'theia-mobile-transcript-tab-icon-select-menu theia-mobile-transcript-terminal-agent-tui-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', menuLabel);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'theia-mobile-transcript-tab-icon-select theia-mobile-transcript-terminal-agent-tui';
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.title = menuLabel;
    trigger.setAttribute('aria-label', menuLabel);

    const chevron = document.createElement('span');
    chevron.className = 'theia-mobile-transcript-tab-icon-select-chevron codicon codicon-chevron-down';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(chevron);
    ctx.syncTerminalAgentTuiTrigger(trigger);

    const loading = document.createElement('div');
    loading.className = 'theia-mobile-transcript-terminal-agent-tui-status';
    loading.textContent = nls.localize('qaap/mobileProjects/terminalAgentTuiLoading', 'Loading agents…');
    menu.append(loading);

    const populate = async (): Promise<void> => {
        const project = ctx.host.transcriptOpenProject ?? ctx.resolveExecutionSurfaceProject();
        if (!project) {
            menu.replaceChildren();
            const empty = document.createElement('div');
            empty.className = 'theia-mobile-transcript-terminal-agent-tui-status';
            empty.textContent = nls.localize(
                'qaap/mobileProjects/terminalAgentTuiNoProject',
                'Open a project to launch an agent.',
            );
            menu.append(empty);
            return;
        }
        try {
            const agents = await ctx.host.stickyComposerAgentsUi.ensureStickyComposerAgentsLoaded(project);
            menu.replaceChildren();
            const launchable = agents.filter(agent => resolveInteractiveAgentCliBin(agent.id));
            const activeAgentId = ctx.resolveTerminalAgentTuiActiveAgentId(project);

            // Always offer a plain terminal as the first option.
            const terminalItem = document.createElement('button');
            terminalItem.type = 'button';
            terminalItem.className = 'theia-mobile-transcript-tab-icon-select-option';
            terminalItem.dataset.agentId = 'terminal';
            terminalItem.setAttribute('role', 'menuitem');
            const terminalLabel = nls.localize('qaap/mobileProjects/terminalPlain', 'Terminal');
            terminalItem.title = terminalLabel;
            terminalItem.setAttribute('aria-label', terminalLabel);
            terminalItem.classList.toggle('theia-mod-active',
                activeAgentId === 'terminal' || !activeAgentId);
            const terminalIcon = document.createElement('span');
            terminalIcon.className = 'theia-mobile-transcript-tab-icon-select-symbol codicon codicon-terminal';
            terminalIcon.setAttribute('aria-hidden', 'true');
            terminalItem.append(terminalIcon);
            const terminalLabelSpan = document.createElement('span');
            terminalLabelSpan.className = 'theia-mobile-transcript-tab-icon-select-option-label';
            terminalLabelSpan.textContent = terminalLabel;
            terminalItem.append(terminalLabelSpan);
            terminalItem.addEventListener('click', event => {
                event.stopPropagation();
                ctx.host.transcriptTerminalPinnedMode = 'terminal';
                ctx.syncTerminalAgentTuiTrigger(trigger, 'terminal');
                ctx.closeExecutionTabOverflowMenu();
                void ctx.host.transcriptSurfacesUi.createTranscriptTerminalSlideForProject(project);
            });
            menu.append(terminalItem);

            if (launchable.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'theia-mobile-transcript-terminal-agent-tui-status';
                empty.textContent = nls.localize(
                    'qaap/mobileProjects/terminalAgentTuiEmpty',
                    'No interactive agents available on this machine.',
                );
                menu.append(empty);
                return;
            }
            for (const agent of launchable) {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'theia-mobile-transcript-tab-icon-select-option';
                item.dataset.agentId = agent.id;
                item.setAttribute('role', 'menuitem');
                item.title = agent.label;
                item.setAttribute('aria-label', agent.label);
                item.toggleAttribute('disabled', agent.available === false);
                item.classList.toggle('theia-mod-active', agent.id === activeAgentId);
                appendAgentBrandIcon(item, agent.id, 'sm');
                const itemLabel = document.createElement('span');
                itemLabel.className = 'theia-mobile-transcript-tab-icon-select-option-label';
                itemLabel.textContent = resolveAgentDisplayLabel(agent.id, agent.label);
                item.append(itemLabel);
                if (agent.available === false) {
                    item.classList.add('theia-mod-unavailable');
                }
                item.addEventListener('click', event => {
                    event.stopPropagation();
                    if (agent.available === false) {
                        return;
                    }
                    ctx.host.stickyComposerPinnedAgentId = agent.id;
                    ctx.syncTerminalAgentTuiTrigger(trigger, agent.id);
                    ctx.closeExecutionTabOverflowMenu();
                    void ctx.host.transcriptSurfacesUi.launchAgentTuiInTranscriptTerminal(
                        project,
                        ctx.host.transcriptOpenSummary ?? ctx.host.resolveAgentsHubShellSummary(project),
                        agent.id,
                    );
                });
                menu.append(item);
            }
        } catch {
            menu.replaceChildren();
            const err = document.createElement('div');
            err.className = 'theia-mobile-transcript-terminal-agent-tui-status';
            err.textContent = nls.localize(
                'qaap/mobileProjects/terminalAgentTuiFailed',
                'Could not load agents.',
            );
            menu.append(err);
        }
    };

    trigger.addEventListener('click', event => {
        event.stopPropagation();
        if (ctx.host.executionTabOverflowMenu?.classList.contains('theia-mod-open')) {
            ctx.closeExecutionTabOverflowMenu();
            return;
        }
        void populate().then(() => {
            ctx.openExecutionTabOverflowMenu(trigger, menu);
        });
    });

    wrap.append(trigger, menu);
    return wrap;
}

export function resolveTerminalAgentTuiActiveAgentIdExtracted(ctx: any, project?: MobileProjectEntry): string | undefined {
    // The terminal menu has its own pinned mode ('terminal' for a plain shell,
    // or an agent id) that is independent from the composer's agent selection.
    // Default to 'terminal' (plain shell) when nothing is pinned yet.
    if (ctx.host.transcriptTerminalPinnedMode) {
        return ctx.host.transcriptTerminalPinnedMode;
    }
    return 'terminal';
}

export function syncTerminalAgentTuiTriggersInStripExtracted(ctx: any, strip: HTMLElement): void {
    for (const trigger of Array.from(strip.querySelectorAll<HTMLButtonElement>('.theia-mobile-transcript-terminal-agent-tui'))) {
        ctx.syncTerminalAgentTuiTrigger(trigger);
    }
}

export function syncTerminalAgentTuiTriggerExtracted(ctx: any, trigger: HTMLButtonElement, agentId?: string): void {
    const resolvedId = agentId ?? ctx.resolveTerminalAgentTuiActiveAgentId();
    const isPlainTerminal = resolvedId === 'terminal';
    const label = isPlainTerminal
        ? nls.localize('qaap/mobileProjects/terminalPlain', 'Terminal')
        : resolvedId
            ? resolveAgentDisplayLabel(resolvedId)
            : nls.localize('qaap/mobileProjects/terminalAgentTui', 'Open agent TUI');
    const chevron = trigger.querySelector('.theia-mobile-transcript-tab-icon-select-chevron');
    for (const child of Array.from(trigger.children)) {
        if (child !== chevron) {
            child.remove();
        }
    }
    if (isPlainTerminal) {
        const symbol = document.createElement('span');
        symbol.className = 'theia-mobile-transcript-tab-icon-select-symbol codicon codicon-terminal';
        symbol.setAttribute('aria-hidden', 'true');
        if (chevron) {
            trigger.insertBefore(symbol, chevron);
        } else {
            trigger.append(symbol);
        }
    } else {
        const brand = createAgentBrandIcon(resolvedId, 'sm');
        if (brand) {
            brand.classList.add('theia-mobile-transcript-tab-icon-select-symbol');
            if (chevron) {
                trigger.insertBefore(brand, chevron);
            } else {
                trigger.append(brand);
            }
        } else {
            const symbol = document.createElement('span');
            symbol.className = 'theia-mobile-transcript-tab-icon-select-symbol codicon codicon-robot';
            symbol.setAttribute('aria-hidden', 'true');
            if (chevron) {
                trigger.insertBefore(symbol, chevron);
            } else {
                trigger.append(symbol);
            }
        }
    }
    if (resolvedId) {
        trigger.dataset.agentId = resolvedId;
    } else {
        delete trigger.dataset.agentId;
    }
    trigger.title = label;
    trigger.setAttribute('aria-label', label);
    // Never inherit view-switcher selected chrome.
    trigger.classList.remove('theia-mod-selected');
    delete trigger.dataset.surfaceActive;
    delete trigger.dataset.tab;
    trigger.removeAttribute('aria-selected');
}

export function executionSurfaceTabSpecsExtracted(ctx: any): Array<{ id: TranscriptTab; label: string; icon: string }> {
    return [
        { id: 'plan', label: nls.localize('qaap/mobileProjects/tabPlan', 'Plan'), icon: 'codicon-file-text' },
        { id: 'review', label: nls.localize('qaap/mobileProjects/tabChanges', 'Changes'), icon: QAAP_SCM_CHANGES_ICON_CLASS },
        { id: 'preview', label: nls.localize('qaap/mobileProjects/tabPreview', 'Preview'), icon: 'codicon-globe' },
        { id: 'files', label: nls.localize('qaap/mobileProjects/tabFiles', 'Files'), icon: 'codicon-folder-opened' },
        { id: 'terminal', label: nls.localize('qaap/mobileProjects/tabTerminal', 'Terminal'), icon: 'codicon-terminal' },
    ];
}

export function createExecutionSurfaceIconSelectExtracted(ctx: any, displayTabId: TranscriptTab,
    activeTab: TranscriptTab,
    tabSpecs: Array<{ id: TranscriptTab; label: string; icon: string }>,
    onSelect: (tab: TranscriptTab) => void,): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'theia-mobile-transcript-tab-icon-select-host';

    const displaySpec = tabSpecs.find(entry => entry.id === displayTabId)
        ?? (displayTabId === 'messages'
            ? { id: 'messages' as TranscriptTab, label: nls.localize('qaap/mobileProjects/tabChat', 'Chat'), icon: QAAP_MESSAGE_CIRCLE_ICON_CLASS }
            : tabSpecs[0]);
    const menuLabel = nls.localize('qaap/mobileProjects/tabOverflow', 'Change view');
    const menuOptions = ctx.executionSurfaceTabSpecs();

    const menu = document.createElement('div');
    menu.className = 'theia-mobile-transcript-tab-icon-select-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', menuLabel);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'theia-mobile-transcript-tab-icon-select';
    trigger.dataset.tab = displaySpec.id;
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('theia-mod-active');
    trigger.classList.add('theia-mod-selected');
    trigger.dataset.surfaceActive = 'true';
    trigger.setAttribute('aria-selected', 'true');
    trigger.title = displaySpec.label;
    trigger.setAttribute('aria-label', menuLabel);

    appendExecutionSurfaceTabIcon(trigger, displaySpec.icon, 'theia-mobile-transcript-tab-icon-select-symbol');
    const triggerLabel = document.createElement('span');
    triggerLabel.className = 'theia-mobile-transcript-tab-icon-select-label';
    triggerLabel.textContent = displaySpec.label;
    triggerLabel.setAttribute('aria-hidden', 'true');
    const chevron = document.createElement('span');
    chevron.className = 'theia-mobile-transcript-tab-icon-select-chevron codicon codicon-chevron-down';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(triggerLabel, chevron);
    trigger.addEventListener('click', event => {
        event.stopPropagation();
        if (ctx.host.executionTabOverflowMenu?.classList.contains('theia-mod-open')) {
            ctx.closeExecutionTabOverflowMenu();
            return;
        }
        ctx.openExecutionTabOverflowMenu(trigger, menu);
    });

    const chatSpec = { id: 'messages' as TranscriptTab, label: nls.localize('qaap/mobileProjects/tabChat', 'Chat'), icon: QAAP_MESSAGE_CIRCLE_ICON_CLASS };
    const allOptions = [chatSpec, ...menuOptions];

    for (const spec of allOptions) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'theia-mobile-transcript-tab-icon-select-option';
        item.dataset.tab = spec.id;
        item.setAttribute('role', 'menuitem');
        item.classList.toggle('theia-mod-active', spec.id === activeTab);
        item.title = spec.label;
        item.setAttribute('aria-label', spec.label);
        appendExecutionSurfaceTabIcon(item, spec.icon, '');
        const itemLabel = document.createElement('span');
        itemLabel.className = 'theia-mobile-transcript-tab-icon-select-option-label';
        itemLabel.textContent = spec.label;
        item.append(itemLabel);
        item.addEventListener('click', event => {
            event.stopPropagation();
            ctx.closeExecutionTabOverflowMenu();
            onSelect(spec.id);
        });
        menu.append(item);
    }

    wrap.append(trigger, menu);
    return wrap;
}

export function resolveExecutionTabOverflowMenuPortalExtracted(ctx: any, anchor: HTMLElement): HTMLElement {
    const transcriptRoot = anchor.closest('.theia-mobile-agent-transcript-root');
    if (transcriptRoot instanceof HTMLElement) {
        return transcriptRoot;
    }
    return ctx.host.root;
}

export function openExecutionTabOverflowMenuExtracted(ctx: any, anchor: HTMLButtonElement, menu: HTMLElement): void {
    ctx.closeExecutionTabOverflowMenu();
    ctx.host.cardMenuUi.closeCardMenu();
    ctx.host.executionTabOverflowAnchor = anchor;
    ctx.host.executionTabOverflowMenu = menu;
    anchor.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    menu.classList.add('theia-mod-open', 'theia-mod-floating');
    ctx.resolveExecutionTabOverflowMenuPortal(anchor).append(menu);
    ctx.scheduleExecutionSurfaceFrame(() => {
        if (ctx.host.executionTabOverflowMenu === menu && ctx.host.executionTabOverflowAnchor === anchor) {
            ctx.positionExecutionTabOverflowMenu(menu, anchor);
        }
    });
    const onDismiss = (event: Event): void => {
        const target = event.target;
        if (target instanceof Node && (menu.contains(target) || anchor.contains(target))) {
            return;
        }
        ctx.closeExecutionTabOverflowMenu();
    };
    const onReposition = (): void => {
        if (ctx.host.executionTabOverflowMenu === menu && ctx.host.executionTabOverflowAnchor === anchor) {
            ctx.positionExecutionTabOverflowMenu(menu, anchor);
        }
    };
    window.setTimeout(() => {
        window.addEventListener('pointerdown', onDismiss, true);
    }, 0);
    window.addEventListener('resize', onReposition);
    ctx.host.scroll.addEventListener('scroll', onReposition, { passive: true });
    ctx.host.executionTabOverflowDispose = Disposable.create(() => {
        window.removeEventListener('pointerdown', onDismiss, true);
        window.removeEventListener('resize', onReposition);
        ctx.host.scroll.removeEventListener('scroll', onReposition);
    });
}

export function executionTabOverflowMenuMinTopExtracted(ctx: any, anchor: HTMLElement): number {
    const gap = 6;
    const titleRow = anchor.closest('.theia-mobile-transcript-tabs')
        ?.closest('.theia-mobile-projects-title-row, .theia-mobile-agent-log-title-row');
    if (titleRow) {
        return titleRow.getBoundingClientRect().bottom + gap;
    }
    const header = anchor.closest('.theia-mobile-agent-log-header, .theia-mobile-projects-header');
    if (header) {
        return header.getBoundingClientRect().bottom + gap;
    }
    return anchor.getBoundingClientRect().bottom + gap;
}

