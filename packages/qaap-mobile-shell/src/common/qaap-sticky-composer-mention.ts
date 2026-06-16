// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { AIVariable } from '@theia/ai-core';
import { appendAgentBrandIcon } from './qaap-agent-branding';
import { QaapAgentTaskAgentOption, THEIA_CODER_AGENT_ID } from './qaap-agent-task-client';
import {
    filterStickyComposerSlashSections,
    type StickyComposerSlashActionId,
    type StickyComposerSlashEntry,
    type StickyComposerSlashSection,
    removeActiveSlashToken,
    renderStickyComposerSlashMenu,
} from './qaap-sticky-composer-slash-menu';
import {
    filterMcpMarketplacePlugins,
    QAAP_MCP_MARKETPLACE_PLUGINS,
} from './qaap-mcp-plugin-marketplace-catalog';
import {
    renderStickyComposerAddPluginPicker,
    renderStickyComposerRemovePluginPicker,
    type StickyComposerPluginPickerMode,
} from './qaap-sticky-composer-plugin-picker';
import { bindStickyComposerControlClick } from './qaap-sticky-composer-control-click';

export type StickyComposerTriggerChar = '@' | '#' | '/';

/** @deprecated Use {@link StickyComposerTokenOption}. */
export type StickyComposerMentionOption = StickyComposerTokenOption;

export interface StickyComposerTokenOption {
    readonly id: string;
    readonly label: string;
    readonly trigger: StickyComposerTriggerChar;
    /** Payload after the trigger character (e.g. `qaiq `, `fileContext:`). */
    readonly insertBody: string;
    readonly description?: string;
}

export function buildStickyComposerMentionOptions(
    backendAgents: readonly QaapAgentTaskAgentOption[],
    coderAgent: { readonly name: string } | undefined,
): StickyComposerTokenOption[] {
    const options: StickyComposerTokenOption[] = [];
    if (coderAgent) {
        options.push({
            id: THEIA_CODER_AGENT_ID,
            label: coderAgent.name,
            trigger: '@',
            insertBody: `${THEIA_CODER_AGENT_ID} `,
        });
    }
    for (const agent of backendAgents) {
        options.push({
            id: agent.id,
            label: agent.label,
            trigger: '@',
            insertBody: `${agent.id} `,
        });
    }
    return options;
}

export function buildStickyComposerSkillOptions(
    skills: readonly { readonly name: string; readonly description?: string }[],
): StickyComposerTokenOption[] {
    return skills.map(skill => ({
        id: skill.name,
        label: skill.name,
        trigger: '/',
        insertBody: `${skill.name} `,
        description: skill.description,
    }));
}

export function buildStickyComposerVariableOptions(
    variables: readonly AIVariable[],
): StickyComposerTokenOption[] {
    return variables.map(variable => ({
        id: variable.name,
        label: variable.label ?? variable.name,
        trigger: '#',
        insertBody: formatVariableInsertBody(variable),
        description: variable.description,
    }));
}

export function formatVariableInsertBody(variable: AIVariable): string {
    const hasRequiredArg = variable.args?.some(arg => !arg.isOptional);
    if (hasRequiredArg) {
        return `${variable.name}:`;
    }
    return `${variable.name} `;
}

/** Trigger fragment (`@agent` / `#var`) ending at `caret`, if the caret is inside one. */
export function findActiveTokenQuery(
    value: string,
    caret: number,
    trigger: StickyComposerTriggerChar,
): { readonly start: number; readonly query: string } | undefined {
    const safeCaret = Math.max(0, Math.min(caret, value.length));
    let wordStart = safeCaret;
    while (wordStart > 0 && /[\w-]/.test(value.charAt(wordStart - 1))) {
        wordStart--;
    }
    const triggerIndex = wordStart - 1;
    if (triggerIndex < 0 || value.charAt(triggerIndex) !== trigger) {
        return undefined;
    }
    if (triggerIndex > 0 && !/\s/.test(value.charAt(triggerIndex - 1))) {
        return undefined;
    }
    return { start: triggerIndex, query: value.slice(wordStart, safeCaret) };
}

export function findActiveComposerToken(
    value: string,
    caret: number,
): { readonly start: number; readonly query: string; readonly trigger: StickyComposerTriggerChar } | undefined {
    const safeCaret = Math.max(0, Math.min(caret, value.length));
    let best: { readonly start: number; readonly query: string; readonly trigger: StickyComposerTriggerChar } | undefined;
    for (const trigger of ['@', '#', '/'] as const) {
        const active = findActiveTokenQuery(value, safeCaret, trigger);
        if (active && (!best || active.start > best.start)) {
            best = { ...active, trigger };
        }
    }
    return best;
}

export function filterTokenOptions(
    options: readonly StickyComposerTokenOption[],
    query: string,
): StickyComposerTokenOption[] {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return [...options];
    }
    return options.filter(option => {
        const body = option.insertBody.trim().toLowerCase();
        const label = option.label.toLowerCase();
        return body.startsWith(needle) || label.startsWith(needle) || option.id.toLowerCase().startsWith(needle);
    });
}

/** @deprecated Use {@link filterTokenOptions}. */
export const filterMentionOptions = filterTokenOptions;

export function applyStickyComposerToken(
    value: string,
    caret: number,
    option: StickyComposerTokenOption,
): { readonly value: string; readonly caret: number } {
    const active = findActiveTokenQuery(value, caret, option.trigger);
    if (active) {
        // Mirror ChatView language completion: keep trigger and replace only the query.
        const replaceStart = active.start + 1;
        const next = value.slice(0, replaceStart) + option.insertBody + value.slice(caret);
        return { value: next, caret: replaceStart + option.insertBody.length };
    }
    const safeCaret = Math.max(0, Math.min(caret, value.length));
    const next = value.slice(0, safeCaret) + `${option.trigger}${option.insertBody}` + value.slice(safeCaret);
    return { value: next, caret: safeCaret + option.insertBody.length + 1 };
}

/** @deprecated Use {@link applyStickyComposerToken}. */
export const applyStickyComposerMention = applyStickyComposerToken;

/** @deprecated Use {@link findActiveComposerToken} or {@link findActiveTokenQuery}. */
export const findActiveMentionQuery = (value: string, caret: number): ReturnType<typeof findActiveTokenQuery> =>
    findActiveTokenQuery(value, caret, '@');

export interface StickyComposerTokenUi {
    readonly mentionBtn: HTMLButtonElement;
    readonly variableBtn?: HTMLButtonElement;
    refresh(): void;
    show(): void;
    hide(): void;
    dispose(): void;
}

/** @deprecated Use {@link StickyComposerTokenUi}. */
export type StickyComposerMentionUi = StickyComposerTokenUi;

export type StickyComposerTextField = HTMLInputElement | HTMLTextAreaElement;

export function attachStickyComposerMentionUi(options: {
    inputWrap: HTMLElement;
    input: StickyComposerTextField;
    getMentionOptions: () => readonly StickyComposerTokenOption[];
    getVariableOptions?: () => readonly StickyComposerTokenOption[];
    getSkillOptions?: () => readonly StickyComposerTokenOption[];
    getSlashMenuSections?: () => readonly StickyComposerSlashSection[];
    onSlashAction?: (actionId: StickyComposerSlashActionId, prompt: string) => void | Promise<void>;
    getInstalledMcpServerSlugs?: () => readonly string[];
    onInstallMcpPlugin?: (pluginId: string) => void | Promise<void>;
    onRemoveMcpServer?: (slug: string) => void | Promise<void>;
    onBrowseMcpMarketplace?: () => void | Promise<void>;
    onDraftChange: (value: string) => void;
    afterInputChange?: () => void;
    mentionButtonTitle: string;
    variableButtonTitle?: string;
}): StickyComposerTokenUi {
    const {
        inputWrap,
        input,
        getMentionOptions,
        getVariableOptions,
        getSkillOptions,
        getSlashMenuSections,
        onSlashAction,
        getInstalledMcpServerSlugs,
        onInstallMcpPlugin,
        onRemoveMcpServer,
        onBrowseMcpMarketplace,
        onDraftChange,
        afterInputChange,
        mentionButtonTitle,
        variableButtonTitle,
    } = options;
    inputWrap.classList.add('theia-mod-mention-host');

    const mentionBtn = document.createElement('button');
    mentionBtn.type = 'button';
    mentionBtn.className = 'theia-mobile-projects-sticky-composer-mention';
    mentionBtn.title = mentionButtonTitle;
    mentionBtn.setAttribute('aria-label', mentionButtonTitle);
    mentionBtn.setAttribute('aria-haspopup', 'listbox');
    mentionBtn.setAttribute('aria-expanded', 'false');
    mentionBtn.innerHTML = '<span class="codicon codicon-mention" aria-hidden="true"></span>';

    let variableBtn: HTMLButtonElement | undefined;
    if (getVariableOptions) {
        variableBtn = document.createElement('button');
        variableBtn.type = 'button';
        variableBtn.className = 'theia-mobile-projects-sticky-composer-variable';
        const title = variableButtonTitle ?? mentionButtonTitle;
        variableBtn.title = title;
        variableBtn.setAttribute('aria-label', title);
        variableBtn.setAttribute('aria-haspopup', 'listbox');
        variableBtn.setAttribute('aria-expanded', 'false');
        variableBtn.innerHTML = '<span class="codicon codicon-symbol-variable" aria-hidden="true"></span>';
    }

    const popover = document.createElement('div');
    popover.className = 'theia-mobile-projects-sticky-composer-mention-popover theia-mod-floating';
    popover.hidden = true;
    popover.setAttribute('role', 'listbox');

    const list = document.createElement('div');
    list.className = 'theia-mobile-projects-sticky-composer-mention-list';
    popover.append(list);
    document.body.append(popover);

    let dismissTimer: ReturnType<typeof setTimeout> | undefined;
    let pickingFromPopover = false;
    let forcedTrigger: StickyComposerTriggerChar | undefined;
    const expandedSlashSections = new Set<string>();
    let slashPluginPanel: StickyComposerPluginPickerMode | undefined;

    const positionPopover = (): void => {
        const rect = input.getBoundingClientRect();
        const gap = 6;
        const horizontalInset = 8;
        const maxWidth = Math.max(0, window.innerWidth - horizontalInset * 2);
        const width = Math.min(rect.width, maxWidth);
        const left = Math.min(
            Math.max(horizontalInset, rect.left),
            window.innerWidth - width - horizontalInset,
        );
        popover.style.left = `${left}px`;
        popover.style.width = `${width}px`;
        popover.style.right = 'auto';
        popover.style.top = 'auto';
        popover.style.bottom = `${Math.max(gap, window.innerHeight - rect.top + gap)}px`;
    };

    const onViewportChange = (): void => {
        if (!popover.hidden) {
            positionPopover();
        }
    };

    const clearDismissTimer = (): void => {
        if (dismissTimer !== undefined) {
            clearTimeout(dismissTimer);
            dismissTimer = undefined;
        }
    };

    const setExpanded = (expanded: boolean): void => {
        mentionBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        variableBtn?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    };

    const hide = (): void => {
        clearDismissTimer();
        popover.hidden = true;
        popover.classList.remove('theia-mod-slash-menu', 'theia-mod-plugin-picker');
        inputWrap.classList.remove('theia-mod-mention-popover-open');
        forcedTrigger = undefined;
        expandedSlashSections.clear();
        slashPluginPanel = undefined;
        list.className = 'theia-mobile-projects-sticky-composer-mention-list';
        setExpanded(false);
    };

    const optionsForTrigger = (trigger: StickyComposerTriggerChar): readonly StickyComposerTokenOption[] => {
        if (trigger === '@') {
            return getMentionOptions();
        }
        if (trigger === '/') {
            return getSkillOptions?.() ?? [];
        }
        return getVariableOptions?.() ?? [];
    };

    const commitSlashEntry = (entry: StickyComposerSlashEntry): void => {
        const caret = input.selectionStart ?? input.value.length;
        const stripped = removeActiveSlashToken(input.value, caret);
        if (entry.kind === 'skill') {
            const token: StickyComposerTokenOption = {
                id: entry.label,
                label: entry.label,
                trigger: '/',
                insertBody: entry.insertBody ?? `${entry.label} `,
                description: entry.description,
            };
            commitToken(token);
            return;
        }
        if (entry.actionId === 'add-plugin' || entry.actionId === 'remove-plugin') {
            slashPluginPanel = entry.actionId;
            renderList();
            positionPopover();
            popover.hidden = false;
            inputWrap.classList.add('theia-mod-mention-popover-open');
            setExpanded(true);
            input.focus();
            return;
        }
        if (entry.actionId) {
            input.value = stripped.value;
            onDraftChange(stripped.value);
            input.setSelectionRange(stripped.caret, stripped.caret);
            afterInputChange?.();
            hide();
            void onSlashAction?.(entry.actionId, stripped.value.trim());
            input.focus();
            return;
        }
        hide();
        input.focus();
    };

    const finishPluginPicker = (): void => {
        const caret = input.selectionStart ?? input.value.length;
        const stripped = removeActiveSlashToken(input.value, caret);
        input.value = stripped.value;
        onDraftChange(stripped.value);
        input.setSelectionRange(stripped.caret, stripped.caret);
        afterInputChange?.();
        hide();
        input.focus();
    };

    const renderPluginPicker = (query: string): number => {
        popover.classList.add('theia-mod-slash-menu', 'theia-mod-plugin-picker');
        if (slashPluginPanel === 'add-plugin') {
            const installed = new Set(getInstalledMcpServerSlugs?.() ?? []);
            const plugins = filterMcpMarketplacePlugins(QAAP_MCP_MARKETPLACE_PLUGINS, query, installed);
            return renderStickyComposerAddPluginPicker({
                list,
                plugins,
                onBack: () => {
                    slashPluginPanel = undefined;
                    renderList();
                    positionPopover();
                },
                onSelectPlugin: plugin => {
                    pickingFromPopover = true;
                    void Promise.resolve(onInstallMcpPlugin?.(plugin.id)).finally(() => {
                        pickingFromPopover = false;
                        finishPluginPicker();
                    });
                },
                onBrowseMarketplace: () => {
                    pickingFromPopover = true;
                    void Promise.resolve(onBrowseMcpMarketplace?.()).finally(() => {
                        pickingFromPopover = false;
                        finishPluginPicker();
                    });
                },
                onPickStart: () => { pickingFromPopover = true; },
            });
        }
        if (slashPluginPanel === 'remove-plugin') {
            const installed = [...(getInstalledMcpServerSlugs?.() ?? [])].sort();
            return renderStickyComposerRemovePluginPicker({
                list,
                installedSlugs: installed,
                onBack: () => {
                    slashPluginPanel = undefined;
                    renderList();
                    positionPopover();
                },
                onRemoveSlug: slug => {
                    pickingFromPopover = true;
                    void Promise.resolve(onRemoveMcpServer?.(slug)).finally(() => {
                        pickingFromPopover = false;
                        finishPluginPicker();
                    });
                },
                onPickStart: () => { pickingFromPopover = true; },
            });
        }
        return 0;
    };

    const renderSlashMenu = (query: string): number => {
        popover.classList.remove('theia-mod-plugin-picker');
        popover.classList.add('theia-mod-slash-menu');
        const sections = filterStickyComposerSlashSections(getSlashMenuSections?.() ?? [], query);
        return renderStickyComposerSlashMenu({
            list,
            sections,
            expandedSections: expandedSlashSections,
            onToggleSection: sectionId => {
                expandedSlashSections.add(sectionId);
                renderList();
            },
            onSelectEntry: commitSlashEntry,
            onPickStart: () => { pickingFromPopover = true; },
        });
    };

    const renderList = (): void => {
        list.replaceChildren();
        if (slashPluginPanel) {
            const caret = input.selectionStart ?? input.value.length;
            const active = findActiveComposerToken(input.value, caret);
            const query = active?.trigger === '/' ? active.query : '';
            renderPluginPicker(query);
            return;
        }
        const caret = input.selectionStart ?? input.value.length;
        let active = findActiveComposerToken(input.value, caret);
        if (forcedTrigger) {
            const forced = findActiveTokenQuery(input.value, caret, forcedTrigger);
            active = {
                start: forced?.start ?? Math.max(0, caret - 1),
                query: forced?.query ?? '',
                trigger: forcedTrigger,
            };
        }
        if (!active) {
            return;
        }
        if (active.trigger === '/' && getSlashMenuSections) {
            if (renderSlashMenu(active.query) === 0) {
                return;
            }
            return;
        }
        popover.classList.remove('theia-mod-slash-menu');
        list.className = 'theia-mobile-projects-sticky-composer-mention-list';
        const filtered = filterTokenOptions(optionsForTrigger(active.trigger), active.query);
        for (const token of filtered) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'theia-mobile-projects-sticky-composer-mention-option';
            btn.setAttribute('role', 'option');
            btn.dataset.tokenId = token.id;
            btn.dataset.tokenTrigger = token.trigger;
            const main = document.createElement('span');
            main.className = 'theia-mobile-projects-sticky-composer-mention-option-main';
            if (token.trigger === '@') {
                appendAgentBrandIcon(main, token.id, 'sm');
            } else if (token.trigger === '/') {
                const icon = document.createElement('span');
                icon.className = 'codicon codicon-book theia-mobile-projects-sticky-composer-mention-option-icon';
                icon.setAttribute('aria-hidden', 'true');
                main.prepend(icon);
            }
            const label = document.createElement('span');
            label.className = 'theia-mobile-projects-sticky-composer-mention-option-label';
            label.textContent = token.label;
            main.append(label);
            const hint = document.createElement('span');
            hint.className = 'theia-mobile-projects-sticky-composer-mention-option-hint';
            hint.textContent = token.description?.trim() || `${token.trigger}${token.insertBody.trimEnd()}`;
            btn.append(main, hint);
            bindStickyComposerControlClick(btn, ev => {
                ev.preventDefault();
                ev.stopPropagation();
                commitToken(token);
                pickingFromPopover = false;
            }, {
                onPressStart: () => {
                    pickingFromPopover = true;
                },
            });
            list.append(btn);
        }
    };

    const show = (): void => {
        clearDismissTimer();
        renderList();
        if (!list.childElementCount) {
            hide();
            return;
        }
        positionPopover();
        popover.hidden = false;
        inputWrap.classList.add('theia-mod-mention-popover-open');
        setExpanded(true);
    };

    const commitToken = (token: StickyComposerTokenOption): void => {
        const caret = input.selectionStart ?? input.value.length;
        const applied = applyStickyComposerToken(input.value, caret, token);
        input.value = applied.value;
        onDraftChange(applied.value);
        input.setSelectionRange(applied.caret, applied.caret);
        afterInputChange?.();
        hide();
        input.focus();
    };

    const refresh = (): void => {
        if (popover.hidden) {
            return;
        }
        renderList();
        if (!list.childElementCount) {
            hide();
            return;
        }
        positionPopover();
    };

    const insertTrigger = (trigger: StickyComposerTriggerChar): void => {
        const caret = input.selectionStart ?? input.value.length;
        const active = findActiveTokenQuery(input.value, caret, trigger);
        if (!active) {
            const next = input.value.slice(0, caret) + trigger + input.value.slice(caret);
            input.value = next;
            onDraftChange(next);
            input.setSelectionRange(caret + 1, caret + 1);
            afterInputChange?.();
        }
        forcedTrigger = trigger;
        show();
        input.focus();
    };

    const openTrigger = (trigger: StickyComposerTriggerChar): void => {
        if (popover.hidden) {
            insertTrigger(trigger);
        } else if (forcedTrigger === trigger) {
            hide();
        } else {
            forcedTrigger = trigger;
            show();
        }
    };

    bindStickyComposerControlClick(mentionBtn, ev => {
        ev.stopPropagation();
        openTrigger('@');
    });

    if (variableBtn) {
        bindStickyComposerControlClick(variableBtn, ev => {
            ev.stopPropagation();
            openTrigger('#');
        });
    }

    const onInput = (): void => {
        forcedTrigger = undefined;
        const caret = input.selectionStart ?? input.value.length;
        const active = findActiveComposerToken(input.value, caret);
        if (active || slashPluginPanel) {
            show();
        } else {
            slashPluginPanel = undefined;
            hide();
        }
    };

    const onBlur = (): void => {
        dismissTimer = setTimeout(() => {
            if (!pickingFromPopover) {
                hide();
            }
            pickingFromPopover = false;
        }, 120);
    };

    const onKeyDown = (ev: KeyboardEvent): void => {
        if (ev.key === 'Escape' && !popover.hidden) {
            ev.preventDefault();
            ev.stopPropagation();
            if (slashPluginPanel) {
                slashPluginPanel = undefined;
                renderList();
                positionPopover();
                return;
            }
            hide();
            return;
        }
        if (popover.hidden) {
            return;
        }
        const buttons = [
            ...list.querySelectorAll<HTMLButtonElement>(
                '.theia-mobile-projects-sticky-composer-mention-option, '
                + '.theia-mobile-projects-sticky-composer-slash-option, '
                + '.theia-mobile-projects-sticky-composer-plugin-picker-option',
            ),
        ];
        if (!buttons.length) {
            return;
        }
        const current = buttons.findIndex(btn => btn.classList.contains('theia-mod-focused'));
        if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            const next = current < 0 ? 0 : Math.min(current + 1, buttons.length - 1);
            buttons.forEach((btn, i) => btn.classList.toggle('theia-mod-focused', i === next));
        } else if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            const next = current < 0 ? buttons.length - 1 : Math.max(current - 1, 0);
            buttons.forEach((btn, i) => btn.classList.toggle('theia-mod-focused', i === next));
        } else if (ev.key === 'Enter' || ev.key === 'Tab') {
            const focused = buttons.find(btn => btn.classList.contains('theia-mod-focused')) ?? buttons[0];
            if (focused) {
                ev.preventDefault();
                ev.stopPropagation();
                const pluginId = focused.dataset.pluginId;
                if (pluginId) {
                    focused.click();
                    return;
                }
                const pluginSlug = focused.dataset.pluginSlug;
                if (pluginSlug) {
                    focused.click();
                    return;
                }
                const slashEntryId = focused.dataset.slashEntryId;
                if (slashEntryId && getSlashMenuSections) {
                    const entry = getSlashMenuSections()
                        .flatMap(section => section.entries)
                        .find(candidate => candidate.id === slashEntryId);
                    if (entry) {
                        commitSlashEntry(entry);
                    }
                    return;
                }
                const id = focused.dataset.tokenId;
                const trigger = focused.dataset.tokenTrigger as StickyComposerTriggerChar | undefined;
                const pool = trigger
                    ? optionsForTrigger(trigger)
                    : [...getMentionOptions(), ...(getVariableOptions?.() ?? []), ...(getSkillOptions?.() ?? [])];
                const token = pool.find(entry => entry.id === id && entry.trigger === trigger);
                if (token) {
                    commitToken(token);
                }
            }
        }
    };

    input.addEventListener('input', onInput);
    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    window.visualViewport?.addEventListener('resize', onViewportChange);
    window.visualViewport?.addEventListener('scroll', onViewportChange);

    return {
        mentionBtn,
        variableBtn,
        refresh,
        show,
        hide,
        dispose: () => {
            clearDismissTimer();
            input.removeEventListener('input', onInput);
            input.removeEventListener('blur', onBlur);
            input.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', onViewportChange);
            window.removeEventListener('scroll', onViewportChange, true);
            window.visualViewport?.removeEventListener('resize', onViewportChange);
            window.visualViewport?.removeEventListener('scroll', onViewportChange);
            popover.remove();
        },
    };
}
