import type { MobileProjectsStickyComposerSheetsUiContext } from './mobile-projects-sticky-composer-sheets-ui-context';
// Extracted from mobile-projects-sticky-composer-sheets-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { agentUsesSettingsModelCatalog, fetchAgentModelsForAgent, type QaapQaiqModelOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import {
    QAAP_AGENT_APPROVAL_POLICIES,
    reconcileAgentApprovalPolicyId,
    resolveApprovalPolicyUnsupportedMode,
    resolveApprovalPolicyUnsupportedText,
    resolveEffectiveAgentApprovalPolicyId,
    writeStoredAgentApprovalPolicy,
    type QaapAgentApprovalPolicyId,
} from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';
import { createApprovalPolicySheetOptionButton } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-ui';
import { qaiqModelSupportsToolCalls } from '@theia/qaap-shared-core/lib/common/qaap-agent-tool-support';
import {
    filterQaiqModelsWithConfiguredCredentials,
    listQaiqModelsFromPreferences,
    listQaiqModelsFromRegisteredLanguageModels,
    mergeQaiqModelOptions,
} from '@theia/qaap-shared-core/lib/common/qaap-qaiq-model-catalog';
import {
    markStickyComposerPopoverAnchor,
    mountStickyComposerBottomSheet,
    mountStickyComposerSheetPopover,
    scheduleStickyComposerPopoverPosition,
} from '@theia/qaap-transcript/lib/browser/qaap-sticky-composer-popover';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

export function openStickyComposerApprovalPolicySheetExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext, project: MobileProjectEntry,
    agentId: string,
    agentLabel: string,
    anchor?: HTMLElement,): void {
    const cwd = ctx.host.projectsService.getProjectCwd(project) ?? ctx.host.preparedCwdByProjectId.get(project.id);
    ctx.openApprovalPolicySheet({
        agentId,
        agentLabel,
        cwd,
        anchor,
        transcriptOverlay: ctx.shouldElevateComposerSheets(),
        selectedId: reconcileAgentApprovalPolicyId(ctx.host.stickyComposerApprovalPolicyId, cwd),
        isOpen: () => ctx.host.stickyComposerApprovalSheet !== undefined,
        onSelect: policyId => {
            ctx.host.stickyComposerApprovalPolicyId = policyId;
            if (cwd) {
                writeStoredAgentApprovalPolicy(cwd, policyId);
            }
            ctx.closeAllComposerSheets();
            ctx.host.stickyComposerRenderUi.renderStickyComposer();
        },
        onClose: () => ctx.closeAllComposerSheets(),
        assignSheet: sheet => { ctx.host.stickyComposerApprovalSheet = sheet; },
    });
}

export function teardownApprovalPolicySheetPopoverExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext): void {
    ctx.approvalPolicyPopoverCleanup?.();
    ctx.approvalPolicyPopoverCleanup = undefined;
    if (ctx.approvalPolicySheetAnchor) {
        markStickyComposerPopoverAnchor(ctx.approvalPolicySheetAnchor, false);
        ctx.approvalPolicySheetAnchor = undefined;
    }
}

export function syncApprovalPolicyPopoverPositionExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext, root: HTMLElement | undefined): void {
    if (!root?.classList.contains('qaap-sticky-composer-sheet-popover') || !ctx.approvalPolicySheetAnchor) {
        return;
    }
    scheduleStickyComposerPopoverPosition(root, ctx.approvalPolicySheetAnchor, ctx.approvalPolicyPopoverAlign);
}

export function mountApprovalPolicySheetPresentationExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext, panel: HTMLElement,
    options: {
        readonly anchor?: HTMLElement;
        readonly transcriptOverlay: boolean;
        readonly onClose: () => void;
    },): HTMLElement {
    ctx.approvalPolicyPopoverAlign = 'start';
    if (ctx.shouldUseAgentPickerPopover(options.anchor)) {
        const mounted = mountStickyComposerSheetPopover(panel, {
            anchor: options.anchor,
            onClose: options.onClose,
            align: ctx.approvalPolicyPopoverAlign,
            transcriptOverlay: options.transcriptOverlay,
            modifierClasses: ['theia-mod-approval-policy-picker'],
        });
        ctx.approvalPolicySheetAnchor = options.anchor;
        ctx.approvalPolicyPopoverCleanup = mounted.cleanup;
        scheduleStickyComposerPopoverPosition(mounted.root, options.anchor, ctx.approvalPolicyPopoverAlign);
        return mounted.root;
    }
    return mountStickyComposerBottomSheet(panel, {
        sheetClassName: options.transcriptOverlay
            ? 'theia-mobile-sticky-composer-sheet theia-mod-approval-policy theia-mod-transcript-overlay'
            : 'theia-mobile-sticky-composer-sheet theia-mod-approval-policy',
        onClose: options.onClose,
    });
}

export function openApprovalPolicySheetExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext, options: {
    /** Harness id; decides whether "Ask before changes" can be offered. */
    readonly agentId: string;
    readonly agentLabel: string;
    readonly cwd: string | undefined;
    readonly selectedId: QaapAgentApprovalPolicyId;
    readonly anchor?: HTMLElement;
    /** Raise above the full-screen transcript overlay (z-index 2147483001). */
    readonly transcriptOverlay?: boolean;
    readonly onSelect: (policyId: QaapAgentApprovalPolicyId) => void;
    readonly onClose: () => void;
    readonly assignSheet: (sheet: HTMLElement) => void;
    readonly isOpen?: () => boolean;
}): void {
    const usePopover = ctx.shouldUseAgentPickerPopover(options.anchor);
    if (usePopover
        && ctx.isApprovalPolicyPopoverAnchoredTo(options.anchor)
        && options.isOpen?.()) {
        options.onClose();
        return;
    }
    options.onClose();

    const panel = document.createElement('section');
    panel.className = 'theia-mobile-sticky-composer-sheet-panel';

    const header = document.createElement('header');
    header.className = 'theia-mobile-sticky-composer-sheet-header';

    const title = document.createElement('h2');
    title.textContent = nls.localize(
        'qaap/mobileProjects/approvalPolicySheetTitle',
        'How should {0} actions be approved?',
        options.agentLabel,
    );

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'theia-mobile-sticky-composer-sheet-close codicon codicon-close';
    close.title = nls.localize('qaap/mobileAgentComposer/close', 'Close');
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', () => options.onClose());

    header.append(title, close);

    const list = document.createElement('div');
    list.className = 'theia-mobile-sticky-composer-sheet-list theia-qaap-approval-policy-sheet-list';
    // The checkmark follows the effective preset: a harness that cannot ask shows Autonomous mode checked.
    let selectedId = resolveEffectiveAgentApprovalPolicyId(options.selectedId, options.agentId) ?? options.selectedId;
    let mountedRoot: HTMLElement | undefined;
    const syncPopover = (): void => {
        if (mountedRoot) {
            window.requestAnimationFrame(() => ctx.syncApprovalPolicyPopoverPosition(mountedRoot));
        }
    };
    const policyButtons: HTMLButtonElement[] = [];
    // Only a harness that runs every action unchecked disables the Ask row; a harness that refuses
    // gated actions keeps it selectable.
    const requestApprovalDisabledReason = resolveApprovalPolicyUnsupportedMode('request-approval', options.agentId) === 'runs-unchecked'
        ? resolveApprovalPolicyUnsupportedText(options.agentLabel, 'runs-unchecked')
        : undefined;
    for (const policy of QAAP_AGENT_APPROVAL_POLICIES) {
        const button = createApprovalPolicySheetOptionButton({
            policy,
            selected: policy.id === selectedId,
            disabledReason: policy.id === 'request-approval' ? requestApprovalDisabledReason : undefined,
            onSelect: () => {
                selectedId = policy.id;
                for (const entry of policyButtons) {
                    entry.classList.remove('theia-mod-selected');
                }
                button.classList.add('theia-mod-selected');
                options.onSelect(selectedId);
            },
        });
        policyButtons.push(button);
        list.append(button);
    }

    panel.append(header, list);
    mountedRoot = ctx.mountApprovalPolicySheetPresentation(panel, {
        anchor: options.anchor,
        transcriptOverlay: options.transcriptOverlay === true,
        onClose: options.onClose,
    });
    document.body.append(mountedRoot);
    options.assignSheet(mountedRoot);
    syncPopover();
}

/** One-line explanation under the Build / Plan rows of the Mode sheet. */
export async function resolveModelsForAgentPickerExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext, agentId: string): Promise<QaapQaiqModelOption[]> {
    const withoutToolLess = (models: readonly QaapQaiqModelOption[]): QaapQaiqModelOption[] =>
        models.filter(model => qaiqModelSupportsToolCalls(model.modelId) !== false);
    if (agentUsesSettingsModelCatalog(agentId)) {
        const readPref = ctx.host.readPreference;
        const fromWorkspace = ctx.host.stickyComposerQaiqModels ?? [];
        const fromPreferences = readPref
            ? listQaiqModelsFromPreferences(readPref)
            : [];
        const registered = ctx.host.getRegisteredLanguageModels
            ? listQaiqModelsFromRegisteredLanguageModels(
                await ctx.host.getRegisteredLanguageModels(),
                readPref,
            )
            : [];
        const merged = mergeQaiqModelOptions(registered, fromWorkspace, fromPreferences);
        const credentialed = readPref
            ? filterQaiqModelsWithConfiguredCredentials(merged, readPref)
            : merged;
        const usable = withoutToolLess(credentialed);
        return usable;
    }
    try {
        return withoutToolLess(await fetchAgentModelsForAgent(agentId));
    } catch {
        throw new Error('agent-model-catalog-fetch-failed');
    }
}

export async function resolveModelsForAgentPickerSafeExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext, agentId: string,): Promise<{ readonly models: QaapQaiqModelOption[]; readonly loadFailed: boolean }> {
    try {
        const models = await ctx.resolveModelsForAgentPicker(agentId);
        ctx.host.stickyComposerAgentsUi.rememberModelLabels(models);
        return { models, loadFailed: false };
    } catch {
        return { models: [], loadFailed: true };
    }
}
