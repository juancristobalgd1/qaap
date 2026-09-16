// @ts-nocheck
// Extracted from mobile-projects-sticky-composer-sheets-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { ChatMode } from '@theia/ai-chat';
import { agentHasCliOAuthLogin, agentNeedsSettingsApiKeyPath } from '../common/qaap-agent-auth-login';
import {
    localizeHostedComposerNoAgentsFilteredMessage,
    localizeHostedComposerNoAgentsMessage,
    readQaapHostedRuntime,
} from '../common/qaap-hosted-agent-auth-policy';
import {
    agentSupportsModelPicker,
    agentUsesSettingsModelCatalog,
    fetchAgentModelsForAgent,
    isSameAgentModel,
    isStickyComposerAgentSelected,
    readStoredAgentModel,
    writeStoredAgent,
    writeStoredAgentModel,
    type QaapAgentTaskAgentOption,
    type QaapQaiqModelOption,
} from '../common/qaap-agent-task-client';
import {
    reconcileComposerModeId,
    resolveStickyComposerModes,
    writeStoredComposerMode,
} from '../common/qaap-sticky-composer-mode';
import {
    QAAP_AGENT_APPROVAL_POLICIES,
    reconcileAgentApprovalPolicyId,
    writeStoredAgentApprovalPolicy,
    type QaapAgentApprovalPolicyId,
} from '../common/qaap-sticky-composer-approval-policy';
import {
    reconcileAgentToolApprovalRules,
    writeStoredAgentToolApprovalRules,
    type QaapAgentToolApprovalRules,
} from '../common/qaap-agent-tool-approval-rules';
import {
    createAgentBrandChip,
    createAgentSheetOptionButton,
    createApprovalPolicySheetOptionButton,
    createModeSheetOptionButton,
    createPickerSheetOptionButton,
    createToolApprovalRuleToggle,
} from './qaap-agent-ui';
import { appendLlmProviderIcon } from '../common/qaap-llm-provider-branding';
import {
    canonicalModelStatsKey,
    formatTurnDuration,
    MODEL_TURN_STATS_SLOW_THRESHOLD_MS,
    resolveModelTurnStats,
} from '../common/qaap-model-latency-stats';
import { qaiqModelSupportsToolCalls } from '../common/qaap-agent-tool-support';
import { formatQaiqModelProviderLabel } from '../common/qaap-qaiq-byok-provider-registry';
import {
    formatQaiqModelSelectionLabel,
    filterQaiqModelsWithConfiguredCredentials,
    groupQaiqModelsByProvider,
    listQaiqModelsFromPreferences,
    listQaiqModelsFromRegisteredLanguageModels,
    mergeQaiqModelOptions,
} from '../common/qaap-qaiq-model-catalog';
import { THEIA_CODER_AGENT_ID } from '../common/qaap-agent-task-client';
import {
    reconcileModelCapabilityLevel,
    writeStoredModelCapabilityLevel,
    type ModelCapabilityLevelValue,
} from '../common/qaap-sticky-composer-model-capability';
import { renderModelCapabilityPopoverPanel } from './model-capability-popover';
import {
    renderContextUsagePopover,
    renderContextUsageSheet,
    wireContextUsagePopoverDismiss,
    type ContextUsageBreakdownView,
} from './qaap-chat-context-usage-panel';
import {
    isStickyComposerAnnotationPopoverAnchor,
    markStickyComposerPopoverAnchor,
    mountStickyComposerBottomSheet,
    mountStickyComposerSheetPopover,
    scheduleStickyComposerPopoverPosition,
    shouldUseStickyComposerDesktopPopover,
    shouldUseStickyComposerPopover,
    type StickyComposerPopoverAlign,
} from './qaap-sticky-composer-popover';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import type { QaapComposerSurface } from '../common/qaap-composer-surface';
import {
    activateAgentPickerEntry,
    buildAgentPickerSearchResults,
    createAgentPickerInlineModelButton,
    modelMatchesAgentPickerQuery,
    type QaapAgentPickerSearchEntry,
} from './qaap-agent-picker-search';
import { renderAgentPickerSkeleton, replaceAgentPickerLoading } from './qaap-agent-picker-loading';

export function createComposerAgentPickerChromeExtracted(ctx: any, options: {
    readonly closeTitle: string;
    readonly onClose: () => void;
    readonly anchor?: HTMLElement;
    readonly transcriptOverlay?: boolean;
    readonly sheetModifierClass?: string;
}): ComposerAgentPickerChrome {
    const panel = document.createElement('section');
    panel.className = 'theia-mobile-sticky-composer-sheet-panel';
    if (options.sheetModifierClass) {
        panel.classList.add(options.sheetModifierClass);
    }

    const header = document.createElement('header');
    header.className = 'theia-mobile-sticky-composer-sheet-header';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'theia-mobile-sticky-composer-sheet-back codicon codicon-arrow-left';
    backBtn.hidden = true;
    backBtn.title = nls.localize('qaap/mobileProjects/backToAgents', 'Back to agents');
    backBtn.setAttribute('aria-label', backBtn.title);

    const title = document.createElement('h2');
    title.textContent = nls.localize('qaap/mobileProjects/stickyComposerPickAgent', 'Choose agent');

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'theia-mobile-sticky-composer-sheet-close codicon codicon-close';
    close.title = options.closeTitle;
    close.setAttribute('aria-label', options.closeTitle);
    close.addEventListener('click', options.onClose);

    header.append(backBtn, title, close);

    const intro = document.createElement('p');
    intro.className = 'theia-qaap-agent-sheet-default-hint';

    const search = document.createElement('div');
    search.className = 'theia-qaap-agent-sheet-search';
    const searchIcon = document.createElement('span');
    searchIcon.className = 'theia-qaap-agent-sheet-search-icon codicon codicon-search';
    searchIcon.setAttribute('aria-hidden', 'true');
    const searchInput = document.createElement('input');
    searchInput.className = 'theia-qaap-agent-sheet-search-input';
    searchInput.type = 'search';
    searchInput.autocomplete = 'off';
    searchInput.spellcheck = false;
    searchInput.placeholder = nls.localize(
        'qaap/mobileProjects/stickyComposerSearchAgentsModels',
        'Search agents and models',
    );
    searchInput.setAttribute('aria-label', searchInput.placeholder);
    search.append(searchIcon, searchInput);

    const list = document.createElement('div');
    list.className = 'theia-mobile-sticky-composer-sheet-list';

    panel.append(header, intro, search, list);

    if (ctx.shouldUseAgentPickerPopover(options.anchor)) {
        const align: StickyComposerPopoverAlign = isStickyComposerAnnotationPopoverAnchor(options.anchor)
            ? 'start'
            : 'end';
        const mounted = mountStickyComposerSheetPopover(panel, {
            anchor: options.anchor,
            onClose: options.onClose,
            align,
            transcriptOverlay: options.transcriptOverlay,
            modifierClasses: [
                'theia-mod-agent-picker',
                ...(options.sheetModifierClass ? [options.sheetModifierClass] : []),
            ],
        });
        return {
            sheet: mounted.root,
            header,
            title,
            backBtn,
            intro,
            searchInput,
            list,
            modelsByAgent: new Map(),
            modelLoadFailedByAgent: new Map(),
            onClose: options.onClose,
            popoverCleanup: mounted.cleanup,
        };
    }

    const baseSheetClassName = options.transcriptOverlay
        ? 'theia-mobile-sticky-composer-sheet theia-mod-agent theia-mod-transcript-overlay'
        : 'theia-mobile-sticky-composer-sheet theia-mod-agent';
    const sheetClassName = options.sheetModifierClass
        ? `${baseSheetClassName} ${options.sheetModifierClass}`
        : baseSheetClassName;
    const sheet = mountStickyComposerBottomSheet(panel, {
        sheetClassName,
        onClose: options.onClose,
    });

    return {
        sheet,
        header,
        title,
        backBtn,
        intro,
        searchInput,
        list,
        modelsByAgent: new Map(),
        modelLoadFailedByAgent: new Map(),
        onClose: options.onClose,
    };
}

export async function renderComposerAgentPickerExtracted(ctx: any, chrome: ComposerAgentPickerChrome,
    options: {
        readonly view: ComposerAgentPickerView;
        readonly modelPickerAgentId?: string;
        readonly cwd: string | undefined;
        readonly agents: readonly QaapAgentTaskAgentOption[];
        readonly selectedAgentId: string | undefined;
        readonly includeCoder: boolean;
        readonly agentsTitle?: string;
        readonly agentsIntro?: string;
        readonly onSelectAgent: (agentId: string, model?: QaapQaiqModelOption) => void;
        /**
         * When set, agents with a real CLI OAuth login get a proactive
         * "Sign in with <agent>" row so the user can authenticate without
         * first running a task that fails. Omitted for one-shot pickers
         * (e.g. Generate UI variant) where no transcript is open.
         */
        readonly onProactiveLogin?: (agentId: string) => void;
    },): Promise<void> {
    const renderGeneration = Number(chrome.sheet.dataset.agentPickerRenderGeneration ?? '0') + 1;
    chrome.sheet.dataset.agentPickerRenderGeneration = String(renderGeneration);
    const rerender = (): void => {
        void ctx.renderComposerAgentPicker(chrome, options);
    };
    const wireSearchKeyboard = (onlyResult?: HTMLElement): void => {
        chrome.searchInput.oninput = rerender;
        chrome.searchInput.onkeydown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (chrome.searchInput.value) {
                    chrome.searchInput.value = '';
                    rerender();
                } else {
                    chrome.onClose();
                }
            } else if (event.key === 'Enter' && onlyResult) {
                event.preventDefault();
                onlyResult.click();
            }
        };
    };
    if (chrome.searchInput.dataset.initialFocusApplied !== 'true') {
        chrome.searchInput.dataset.initialFocusApplied = 'true';
        window.requestAnimationFrame(() => chrome.searchInput.focus({ preventScroll: true }));
    }
    if (options.view === 'models' && options.modelPickerAgentId) {
        const modelAgentId = options.modelPickerAgentId;
        let pickerModels = chrome.modelsByAgent.get(modelAgentId);
        const loadFailed = chrome.modelLoadFailedByAgent.get(modelAgentId) === true;
        if (pickerModels === undefined || (pickerModels.length === 0 && loadFailed)) {
            renderAgentPickerSkeleton(chrome.list, 5);
            const resolved = await ctx.resolveModelsForAgentPickerSafe(modelAgentId);
            if (chrome.sheet.dataset.agentPickerRenderGeneration !== String(renderGeneration)) {
                return;
            }
            pickerModels = resolved.models;
            chrome.modelsByAgent.set(modelAgentId, pickerModels);
            if (resolved.loadFailed) {
                chrome.modelLoadFailedByAgent.set(modelAgentId, true);
            } else {
                chrome.modelLoadFailedByAgent.delete(modelAgentId);
            }
        }
        if (chrome.sheet.dataset.agentPickerRenderGeneration !== String(renderGeneration)) {
            return;
        }
        const storedModel = readStoredAgentModel(options.cwd, modelAgentId);
        chrome.header.classList.add('theia-mod-drilldown');
        chrome.backBtn.hidden = false;
        chrome.intro.hidden = true;
        const modelAgentLabel = options.agents.find(agent => agent.id === modelAgentId)?.label ?? modelAgentId;
        chrome.title.textContent = nls.localize(
            'qaap/mobileProjects/stickyComposerPickModelForAgent',
            'Choose model for {0}',
            modelAgentLabel,
        );
        chrome.backBtn.onclick = () => {
            void ctx.renderComposerAgentPicker(chrome, { ...options, view: 'agents', modelPickerAgentId: undefined });
        };
        const filteredModels = (pickerModels ?? []).filter(model => modelMatchesAgentPickerQuery(model, chrome.searchInput.value));
        const modelContent = document.createElement('div');
        ctx.appendAgentModelPickerList(
            modelContent,
            modelAgentId,
            filteredModels,
            storedModel,
            model => options.onSelectAgent(modelAgentId, model),
            chrome.modelLoadFailedByAgent.get(modelAgentId) === true,
            () => {
                chrome.modelsByAgent.delete(modelAgentId);
                chrome.modelLoadFailedByAgent.delete(modelAgentId);
                rerender();
            },
        );
        if ((pickerModels?.length ?? 0) > 0 && filteredModels.length === 0) {
            replaceAgentPickerLoading(chrome.list, ctx.createAgentPickerNoResultsHint());
        } else {
            replaceAgentPickerLoading(chrome.list, ...Array.from(modelContent.childNodes));
        }
        const modelButtons = chrome.list.querySelectorAll<HTMLElement>('.theia-mobile-sticky-composer-sheet-option');
        wireSearchKeyboard(modelButtons.length === 1 ? modelButtons[0] : undefined);
        window.requestAnimationFrame(() => ctx.syncAgentPickerPopoverPosition(chrome.sheet));
        return;
    }

    chrome.header.classList.remove('theia-mod-drilldown');
    chrome.backBtn.hidden = true;
    chrome.backBtn.onclick = null;
    chrome.intro.hidden = true;
    chrome.title.textContent = options.agentsTitle
        ?? nls.localize('qaap/mobileProjects/stickyComposerPickAgent', 'Choose agent');

    const agentEntries: QaapAgentPickerSearchEntry[] = [];
    if (options.includeCoder) {
        const coder = ctx.host.stickyComposerAgentsUi.getOfferableCoderAgent();
        if (coder) {
            agentEntries.push({ id: THEIA_CODER_AGENT_ID, label: coder.name, models: [] });
        }
    }
    for (const agent of options.agents) {
        agentEntries.push({ id: agent.id, label: agent.label, models: [] });
    }
    if (agentEntries.some(entry => agentSupportsModelPicker(entry.id) && !chrome.modelsByAgent.has(entry.id))) {
        renderAgentPickerSkeleton(chrome.list);
    }
    await Promise.all(agentEntries.map(async entry => {
        let models = chrome.modelsByAgent.get(entry.id);
        if (models === undefined) {
            if (agentSupportsModelPicker(entry.id)) {
                const resolved = await ctx.resolveModelsForAgentPickerSafe(entry.id);
                models = resolved.models;
                if (chrome.sheet.dataset.agentPickerRenderGeneration === String(renderGeneration)) {
                    if (resolved.loadFailed) {
                        chrome.modelLoadFailedByAgent.set(entry.id, true);
                    } else {
                        chrome.modelLoadFailedByAgent.delete(entry.id);
                    }
                }
            } else {
                models = [];
            }
        }
        if (chrome.sheet.dataset.agentPickerRenderGeneration === String(renderGeneration)) {
            chrome.modelsByAgent.set(entry.id, models);
        }
        (entry as { models: readonly QaapQaiqModelOption[] }).models = models;
    }));
    if (chrome.sheet.dataset.agentPickerRenderGeneration !== String(renderGeneration)) {
        return;
    }

    const searchResults = buildAgentPickerSearchResults(agentEntries, chrome.searchInput.value);
    const content = document.createDocumentFragment();
    const appendAgent = (entry: QaapAgentPickerSearchEntry): void => {
        const { id: agentId, label } = entry;
        const hasModels = agentSupportsModelPicker(agentId);
        const agentSelected = isStickyComposerAgentSelected(agentId, options.selectedAgentId, options.cwd);
        const storedModel = readStoredAgentModel(options.cwd, agentId);
        let displayLabel = label;
        if (storedModel?.modelId && agentSelected) {
            displayLabel = `${label} · ${formatQaiqModelSelectionLabel(storedModel)}`;
        }
        content.append(createAgentSheetOptionButton({
            agentId,
            label: displayLabel,
            selected: agentSelected,
            submenuChevron: hasModels ? 'forward' : undefined,
            onSelect: () => {
                void activateAgentPickerEntry({
                    agentId,
                    supportsModels: hasModels,
                    cachedModels: chrome.modelsByAgent.get(agentId),
                    loadModels: async () => {
                        const resolved = await ctx.resolveModelsForAgentPickerSafe(agentId);
                        if (resolved.loadFailed) {
                            chrome.modelLoadFailedByAgent.set(agentId, true);
                        } else {
                            chrome.modelLoadFailedByAgent.delete(agentId);
                        }
                        return resolved.models;
                    },
                    onLoading: () => {
                        // Invalidate any in-flight agents-list render so it cannot replace
                        // this activation skeleton and race the drill-down navigation.
                        chrome.sheet.dataset.agentPickerRenderGeneration = String(
                            Number(chrome.sheet.dataset.agentPickerRenderGeneration ?? '0') + 1,
                        );
                        renderAgentPickerSkeleton(chrome.list, 5);
                    },
                    onModelsResolved: models => chrome.modelsByAgent.set(agentId, models),
                    onShowModels: () => {
                        if (chrome.searchInput.value
                            && !(chrome.modelsByAgent.get(agentId) ?? [])
                                .some(model => modelMatchesAgentPickerQuery(model, chrome.searchInput.value))) {
                            chrome.searchInput.value = '';
                        }
                        void ctx.renderComposerAgentPicker(chrome, {
                            ...options,
                            view: 'models',
                            modelPickerAgentId: agentId,
                        });
                    },
                    onSelectDirect: () => options.onSelectAgent(agentId),
                });
            },
        }));
        if (options.onProactiveLogin && agentHasCliOAuthLogin(agentId)) {
            content.append(ctx.createProactiveLoginRow(label, () => options.onProactiveLogin!(agentId)));
        } else if (options.onOpenAiFeaturesSettings && agentNeedsSettingsApiKeyPath(agentId)) {
            content.append(ctx.createProactiveSettingsApiKeyRow(label, () => options.onOpenAiFeaturesSettings!(agentId)));
        }
    };

    for (const entry of searchResults.directAgents) {
        appendAgent(entry);
    }
    for (const [groupIndex, group] of searchResults.modelGroups.entries()) {
        const section = document.createElement('section');
        section.className = 'theia-qaap-agent-sheet-inline-model-group';
        section.dataset.agentId = group.agent.id;
        const heading = createAgentBrandChip({
            agentId: group.agent.id,
            label: group.agent.label,
        });
        heading.classList.add('theia-qaap-agent-sheet-inline-model-group-heading');
        heading.id = `qaap-agent-model-group-${renderGeneration}-${groupIndex}`;
        section.setAttribute('aria-labelledby', heading.id);
        section.append(heading);
        const storedModel = readStoredAgentModel(options.cwd, group.agent.id);
        const agentSelected = isStickyComposerAgentSelected(
            group.agent.id,
            options.selectedAgentId,
            options.cwd,
        );
        for (const model of group.models) {
            section.append(createAgentPickerInlineModelButton({
                agentId: group.agent.id,
                model,
                selected: agentSelected && isSameAgentModel(storedModel, model),
                onSelect: options.onSelectAgent,
            }));
        }
        content.append(section);
    }
    const resultCount = searchResults.directAgents.length
        + searchResults.modelGroups.reduce((count, group) => count + group.models.length, 0);
    if (agentEntries.length > 0 && resultCount === 0) {
        content.append(ctx.createAgentPickerNoResultsHint());
    } else if (agentEntries.length === 0) {
        const hint = document.createElement('p');
        hint.className = 'theia-qaap-agent-sheet-empty-models';
        const agentConfigured = ctx.host.activeTasks?.isAgentConfigured() ?? false;
        hint.textContent = readQaapHostedRuntime()
            ? (agentConfigured
                ? localizeHostedComposerNoAgentsFilteredMessage()
                : localizeHostedComposerNoAgentsMessage())
            : agentConfigured
            ? nls.localize(
                'qaap/mobileProjects/stickyComposerNoAgentsFiltered',
                'Agents were detected on the server but none are selectable in this composer. Restart the backend after installing CLIs (cursor-agent, qaiq, codex, claude, …).',
            )
            : nls.localize(
                'qaap/mobileProjects/stickyComposerNoAgents',
                'No agents are available. Install a VPS agent CLI on PATH (cursor-agent, qaiq, codex, claude) or set QAAP_AGENT_COMMAND, then restart the backend.',
            );
        content.append(hint);
    }
    replaceAgentPickerLoading(chrome.list, content);
    const resultButtons = chrome.list.querySelectorAll<HTMLElement>(
        '.theia-qaap-agent-sheet-option, .theia-qaap-agent-sheet-inline-model',
    );
    wireSearchKeyboard(resultButtons.length === 1 ? resultButtons[0] : undefined);
    window.requestAnimationFrame(() => ctx.syncAgentPickerPopoverPosition(chrome.sheet));
}

