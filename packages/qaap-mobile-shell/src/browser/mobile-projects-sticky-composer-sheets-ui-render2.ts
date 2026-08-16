// @ts-nocheck
// Extracted from mobile-projects-sticky-composer-sheets-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { ChatMode } from '@theia/ai-chat';
import { agentHasCliOAuthLogin } from '../common/qaap-agent-auth-login';
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

export function shouldElevateComposerSheetsExtracted(ctx: any): boolean {
        return ctx.host.agentsHubShellActive === true
            || document.body.classList.contains('theia-mobile-mod-workhub-composer-header')
            || document.body.classList.contains('theia-mobile-mod-workhub-no-bottom-chrome');
}

export function closeStickyComposerSheetsExtracted(ctx: any): void {
        ctx.teardownAgentPickerPopover();
        if (ctx.host.stickyComposerAgentSheet) {
            ctx.host.stickyComposerAgentSheet.remove();
            ctx.host.stickyComposerAgentSheet = undefined;
        }
        ctx.teardownModeSheetPopover();
        if (ctx.host.stickyComposerModeSheet) {
            ctx.host.stickyComposerModeSheet.remove();
            ctx.host.stickyComposerModeSheet = undefined;
        }
        ctx.teardownApprovalPolicySheetPopover();
        if (ctx.host.stickyComposerApprovalSheet) {
            ctx.host.stickyComposerApprovalSheet.remove();
            ctx.host.stickyComposerApprovalSheet = undefined;
        }
        ctx.host.stickyComposerWorkspaceUi.closeComposerWorkspaceSheet();
        ctx.teardownContextUsagePresentation();
        ctx.teardownCapabilityPresentation();
}

export function teardownCapabilityPresentationExtracted(ctx: any): void {
        ctx.capabilityPopoverCleanup?.();
        ctx.capabilityPopoverCleanup = undefined;
        if (ctx.capabilitySheetAnchor) {
            markStickyComposerPopoverAnchor(ctx.capabilitySheetAnchor, false);
            ctx.capabilitySheetAnchor = undefined;
        }
        if (ctx.host.stickyComposerCapabilitySheet) {
            ctx.host.stickyComposerCapabilitySheet.remove();
            ctx.host.stickyComposerCapabilitySheet = undefined;
        }
}

export function teardownContextUsagePresentationExtracted(ctx: any): void {
        ctx.contextUsagePopoverCleanup?.();
        ctx.contextUsagePopoverCleanup = undefined;
        if (ctx.contextUsageAnchor) {
            ctx.contextUsageAnchor.setAttribute('aria-expanded', 'false');
            ctx.contextUsageAnchor.classList.remove('theia-mod-active');
            ctx.contextUsageAnchor = undefined;
        }
        if (ctx.host.stickyComposerContextUsageSheet) {
            ctx.host.stickyComposerContextUsageSheet.remove();
            ctx.host.stickyComposerContextUsageSheet = undefined;
        }
}

export function openStickyComposerContextUsageSheetExtracted(ctx: any, refreshBreakdown: () => ContextUsageBreakdownView,
        transcriptOverlay?: boolean,
        anchor?: HTMLElement,): void {
        const usePopover = shouldUseStickyComposerDesktopPopover(anchor);
        if (usePopover
            && ctx.contextUsageAnchor === anchor
            && ctx.host.stickyComposerContextUsageSheet) {
            ctx.closeAllComposerSheets();
            return;
        }
        ctx.closeAllComposerSheets();
        const overlay = transcriptOverlay ?? ctx.shouldElevateComposerSheets();
        const onClose = (): void => { ctx.closeAllComposerSheets(); };
        const view = refreshBreakdown();
        if (usePopover && anchor) {
            const popover = renderContextUsagePopover(view, {
                transcriptOverlay: overlay,
                onClose,
            });
            document.body.append(popover);
            ctx.host.stickyComposerContextUsageSheet = popover;
            ctx.contextUsageAnchor = anchor;
            anchor.setAttribute('aria-expanded', 'true');
            anchor.classList.add('theia-mod-active');
            ctx.contextUsagePopoverCleanup = wireContextUsagePopoverDismiss(popover, anchor, onClose);
            return;
        }
        const sheet = renderContextUsageSheet(view, {
            transcriptOverlay: overlay,
            onClose,
        });
        document.body.append(sheet);
        ctx.host.stickyComposerContextUsageSheet = sheet;
}

export function openStickyComposerModelCapabilityPopoverExtracted(ctx: any, options: {
        readonly anchor: HTMLButtonElement;
        readonly cwd: string | undefined;
        readonly transcriptOverlay?: boolean;
        readonly resolveLevel: () => ModelCapabilityLevelValue;
        readonly assignLevel: (level: ModelCapabilityLevelValue) => void;
        readonly onCommit?: () => void;
    }): void {
        const usePopover = shouldUseStickyComposerPopover(options.anchor);
        if (usePopover
            && ctx.capabilitySheetAnchor === options.anchor
            && ctx.host.stickyComposerCapabilitySheet) {
            ctx.closeAllComposerSheets();
            return;
        }
        ctx.closeAllComposerSheets();
        const level = reconcileModelCapabilityLevel(options.resolveLevel(), options.cwd);
        const overlay = options.transcriptOverlay ?? ctx.shouldElevateComposerSheets();
        const onClose = (): void => { ctx.closeAllComposerSheets(); };
        const panel = renderModelCapabilityPopoverPanel({
            level,
            onCommit: next => {
                options.assignLevel(next);
                if (options.cwd) {
                    writeStoredModelCapabilityLevel(options.cwd, next);
                }
                options.onCommit?.();
            },
        });
        if (usePopover) {
            const mounted = mountStickyComposerSheetPopover(panel, {
                anchor: options.anchor,
                onClose,
                align: 'end',
                transcriptOverlay: overlay,
                modifierClasses: ['theia-mod-model-capability'],
            });
            document.body.append(mounted.root);
            ctx.host.stickyComposerCapabilitySheet = mounted.root;
            ctx.capabilitySheetAnchor = options.anchor;
            ctx.capabilityPopoverAlign = 'end';
            ctx.capabilityPopoverCleanup = mounted.cleanup;
            scheduleStickyComposerPopoverPosition(mounted.root, options.anchor, ctx.capabilityPopoverAlign);
            return;
        }
        const sheet = mountStickyComposerBottomSheet(panel, {
            sheetClassName: overlay
                ? 'theia-mobile-sticky-composer-sheet theia-mod-model-capability theia-mod-transcript-overlay'
                : 'theia-mobile-sticky-composer-sheet theia-mod-model-capability',
            onClose,
        });
        document.body.append(sheet);
        ctx.host.stickyComposerCapabilitySheet = sheet;
        ctx.capabilitySheetAnchor = options.anchor;
        markStickyComposerPopoverAnchor(options.anchor, true);
}

export function teardownAgentPickerPopoverExtracted(ctx: any): void {
        ctx.agentPopoverCleanup?.();
        ctx.agentPopoverCleanup = undefined;
        if (ctx.agentSheetAnchor) {
            markStickyComposerPopoverAnchor(ctx.agentSheetAnchor, false);
            ctx.agentSheetAnchor = undefined;
        }
}

export function syncAgentPickerPopoverPositionExtracted(ctx: any, root: HTMLElement | undefined): void {
        if (!root?.classList.contains('qaap-sticky-composer-sheet-popover') || !ctx.agentSheetAnchor) {
            return;
        }
        scheduleStickyComposerPopoverPosition(root, ctx.agentSheetAnchor, ctx.agentPopoverAlign);
}

export function assignAgentPickerPopoverExtracted(ctx: any, anchor: HTMLElement, cleanup: (() => void) | undefined): void {
        ctx.agentSheetAnchor = anchor;
        // Annotation footer chip sits mid-card; start-align so the menu stays over the comment UI.
        ctx.agentPopoverAlign = isStickyComposerAnnotationPopoverAnchor(anchor) ? 'start' : 'end';
        ctx.agentPopoverCleanup = cleanup;
}

export function openStickyComposerAgentSheetExtracted(ctx: any, project: MobileProjectEntry, anchor?: HTMLElement): void {
        if (ctx.host.stickyComposerSurface === 'chat') {
            return;
        }
        const usePopover = ctx.shouldUseAgentPickerPopover(anchor);
        if (usePopover
            && ctx.agentSheetAnchor === anchor
            && ctx.host.stickyComposerAgentSheet) {
            ctx.closeAllComposerSheets();
            return;
        }
        ctx.closeAllComposerSheets();
        const cwd = ctx.host.projectsService.getProjectCwd(project) ?? ctx.host.preparedCwdByProjectId.get(project.id);
        const onClose = (): void => { ctx.closeAllComposerSheets(); };
        const chrome = ctx.createComposerAgentPickerChrome({
            closeTitle: nls.localize('qaap/mobileAgentComposer/close', 'Close'),
            onClose,
            anchor,
            transcriptOverlay: ctx.shouldElevateComposerSheets(),
        });
        document.body.append(chrome.sheet);
        ctx.host.stickyComposerAgentSheet = chrome.sheet;
        if (ctx.shouldUseAgentPickerPopover(anchor)) {
            ctx.assignAgentPickerPopover(anchor, chrome.popoverCleanup);
            scheduleStickyComposerPopoverPosition(chrome.sheet, anchor, ctx.agentPopoverAlign);
        }
        const loadAgentCatalog = (): void => {
            ctx.host.stickyComposerAgentsUi.showComposerAgentPickerLoading(chrome);
            ctx.syncAgentPickerPopoverPosition(chrome.sheet);
            void ctx.host.stickyComposerAgentsUi.ensureStickyComposerAgentsLoaded(project, { force: true }).then(agents => {
                if (ctx.host.stickyComposerAgentSheet !== chrome.sheet) {
                    return;
                }
                void ctx.renderComposerAgentPicker(chrome, {
                view: 'agents',
                cwd,
                agents,
                selectedAgentId: ctx.host.stickyComposerPinnedAgentId,
                includeCoder: true,
                onSelectAgent: (agentId, model) => {
                    ctx.host.stickyComposerPinnedAgentId = agentId;
                    void (async (): Promise<void> => {
                        if (cwd) {
                            writeStoredAgent(cwd, agentId);
                            if (model) {
                                writeStoredAgentModel(cwd, agentId, model);
                            } else {
                                await ctx.host.stickyComposerAgentsUi.ensureStickyComposerAgentModel(agentId, cwd);
                            }
                        }
                        const modes = resolveStickyComposerModes(agentId, ctx.host.chatAgentService);
                        ctx.host.stickyComposerModeId = reconcileComposerModeId(undefined, modes, cwd);
                        if (cwd && ctx.host.stickyComposerModeId) {
                            writeStoredComposerMode(cwd, ctx.host.stickyComposerModeId);
                        }
                        ctx.closeAllComposerSheets();
                        ctx.host.stickyComposerRenderUi.renderStickyComposer();
                    })();
                },
                onProactiveLogin: ctx.host.openAgentSignInTerminal
                    ? agentId => {
                        ctx.closeAllComposerSheets();
                        void ctx.host.openAgentSignInTerminal?.(agentId);
                    }
                    : undefined,
                });
            }).catch(() => {
                if (ctx.host.stickyComposerAgentSheet === chrome.sheet) {
                    ctx.host.stickyComposerAgentsUi.showComposerAgentPickerError(chrome, loadAgentCatalog);
                }
            });
        };
        loadAgentCatalog();
}

export function openExternalAgentPickerForSubmitExtracted(ctx: any, project: MobileProjectEntry,
        draft: string,
        options: {
            readonly title?: string;
            readonly intro?: string;
            readonly anchor?: HTMLElement;
        } = {},): void {
        const usePopover = ctx.shouldUseAgentPickerPopover(options.anchor);
        if (usePopover
            && ctx.agentSheetAnchor === options.anchor
            && ctx.host.stickyComposerAgentSheet) {
            ctx.closeAllComposerSheets();
            return;
        }
        ctx.closeAllComposerSheets();
        const cwd = ctx.host.projectsService.getProjectCwd(project) ?? ctx.host.preparedCwdByProjectId.get(project.id);
        const onClose = (): void => { ctx.closeAllComposerSheets(); };
        const chrome = ctx.createComposerAgentPickerChrome({
            closeTitle: nls.localize('qaap/mobileAgentComposer/close', 'Close'),
            onClose,
            anchor: options.anchor,
            transcriptOverlay: ctx.shouldElevateComposerSheets(),
            sheetModifierClass: 'theia-mod-generate-variant',
        });
        document.body.append(chrome.sheet);
        ctx.host.stickyComposerAgentSheet = chrome.sheet;
        if (ctx.shouldUseAgentPickerPopover(options.anchor) && options.anchor) {
            ctx.assignAgentPickerPopover(options.anchor, chrome.popoverCleanup);
            scheduleStickyComposerPopoverPosition(chrome.sheet, options.anchor, ctx.agentPopoverAlign);
        }
        const agentsTitle = options.title
            ?? nls.localize('qaap/elementInspector/pickVariantAgentTitle', 'Choose agent for UI variant');
        const agentsIntro = options.intro
            ?? nls.localize(
                'qaap/elementInspector/pickVariantAgentIntro',
                'Pick who should design the variant, then a model if available. The task starts right after.',
            );
        const loadAgentCatalog = (): void => {
            ctx.host.stickyComposerAgentsUi.showComposerAgentPickerLoading(chrome);
            ctx.syncAgentPickerPopoverPosition(chrome.sheet);
            void ctx.host.stickyComposerAgentsUi.ensureStickyComposerAgentsLoaded(project, { force: true }).then(agents => {
                if (ctx.host.stickyComposerAgentSheet !== chrome.sheet) {
                    return;
                }
                void ctx.renderComposerAgentPicker(chrome, {
                    view: 'agents',
                    cwd,
                    agents,
                    selectedAgentId: ctx.host.stickyComposerAgentsUi.resolveStickyComposerPinnedAgentId(project),
                    includeCoder: false,
                    agentsTitle,
                    agentsIntro,
                    onSelectAgent: (agentId, model) => {
                        ctx.host.stickyComposerPinnedAgentId = agentId;
                        void (async (): Promise<void> => {
                            let resolvedModel: QaapCreateAgentTaskQaiqModel | undefined = model
                                ? { provider: model.provider, vendor: model.vendor, modelId: model.modelId }
                                : undefined;
                            if (cwd) {
                                writeStoredAgent(cwd, agentId);
                                if (model) {
                                    writeStoredAgentModel(cwd, agentId, model);
                                } else {
                                    resolvedModel = await ctx.host.stickyComposerAgentsUi.ensureStickyComposerAgentModel(agentId, cwd);
                                }
                            }
                            ctx.closeAllComposerSheets();
                            void ctx.host.submitExternalComposerPrompt?.(draft, {
                                agentId,
                                ...(resolvedModel ? { agentModel: resolvedModel } : {}),
                            });
                        })();
                    },
                });
            }).catch(() => {
                if (ctx.host.stickyComposerAgentSheet === chrome.sheet) {
                    ctx.host.stickyComposerAgentsUi.showComposerAgentPickerError(chrome, loadAgentCatalog);
                }
            });
        };
        loadAgentCatalog();
}

export function teardownModeSheetPopoverExtracted(ctx: any): void {
        ctx.modePopoverCleanup?.();
        ctx.modePopoverCleanup = undefined;
        if (ctx.modeSheetAnchor) {
            markStickyComposerPopoverAnchor(ctx.modeSheetAnchor, false);
            ctx.modeSheetAnchor = undefined;
        }
}

export function mountModeSheetPresentationExtracted(ctx: any, panel: HTMLElement,
        options: {
            readonly anchor?: HTMLElement;
            readonly transcriptOverlay: boolean;
            readonly onClose: () => void;
        },): HTMLElement {
        ctx.modePopoverAlign = 'start';
        if (ctx.shouldUseAgentPickerPopover(options.anchor)) {
            const mounted = mountStickyComposerSheetPopover(panel, {
                anchor: options.anchor,
                onClose: options.onClose,
                align: ctx.modePopoverAlign,
                transcriptOverlay: options.transcriptOverlay,
                modifierClasses: ['theia-mod-mode-picker'],
            });
            ctx.modeSheetAnchor = options.anchor;
            ctx.modePopoverCleanup = mounted.cleanup;
            scheduleStickyComposerPopoverPosition(mounted.root, options.anchor, ctx.modePopoverAlign);
            return mounted.root;
        }
        return mountStickyComposerBottomSheet(panel, {
            sheetClassName: options.transcriptOverlay
                ? 'theia-mobile-sticky-composer-sheet theia-mod-mode theia-mod-transcript-overlay'
                : 'theia-mobile-sticky-composer-sheet theia-mod-mode',
            onClose: options.onClose,
        });
}

