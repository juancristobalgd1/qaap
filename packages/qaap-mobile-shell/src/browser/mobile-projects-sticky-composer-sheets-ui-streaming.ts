import type { MobileProjectsStickyComposerSheetsUiContext } from './mobile-projects-sticky-composer-sheets-ui-context';
// Extracted from mobile-projects-sticky-composer-sheets-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { ChatMode } from '@theia/ai-chat';
import {
    agentUsesSettingsModelCatalog,
    fetchAgentModelsForAgent,
    isStickyComposerAgentSelected,
    type QaapQaiqModelOption,
} from '../common/qaap-agent-task-client';
import {
    writeStoredComposerMode,
} from '../common/qaap-sticky-composer-mode';
import {
    QAAP_AGENT_APPROVAL_POLICIES,
    reconcileAgentApprovalPolicyId,
    writeStoredAgentApprovalPolicy,
    type QaapAgentApprovalPolicyId,
} from '../common/qaap-sticky-composer-approval-policy';
import {
    createAgentSheetOptionButton,
    createApprovalPolicySheetOptionButton,
    createModeSheetOptionButton,
} from './qaap-agent-ui';
import { qaiqModelSupportsToolCalls } from '../common/qaap-agent-tool-support';
import {
    filterQaiqModelsWithConfiguredCredentials,
    listQaiqModelsFromPreferences,
    listQaiqModelsFromRegisteredLanguageModels,
    mergeQaiqModelOptions,
} from '../common/qaap-qaiq-model-catalog';
import {
    markStickyComposerPopoverAnchor,
    mountStickyComposerBottomSheet,
    mountStickyComposerSheetPopover,
    scheduleStickyComposerPopoverPosition,
} from './qaap-sticky-composer-popover';
import type { MobileProjectEntry } from './mobile-projects-types';

export function openComposerModeSheetExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext, options: {
    readonly modes: readonly ChatMode[];
    readonly selectedModeId: string | undefined;
    readonly cwd: string | undefined;
    readonly anchor?: HTMLElement;
    readonly transcriptOverlay: boolean;
    readonly closeTitle: string;
    readonly onClose: () => void;
    readonly onSelect: (modeId: string) => void;
    readonly assignSheet: (sheet: HTMLElement) => void;
    readonly isOpen?: () => boolean;
}): void {
    const usePopover = ctx.shouldUseAgentPickerPopover(options.anchor);
    if (usePopover
        && ctx.isModeSheetPopoverAnchoredTo(options.anchor)
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
    title.textContent = nls.localize('qaap/mobileProjects/stickyComposerPickMode', 'Choose mode');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'theia-mobile-sticky-composer-sheet-close codicon codicon-close';
    close.title = options.closeTitle;
    close.setAttribute('aria-label', options.closeTitle);
    close.addEventListener('click', options.onClose);
    header.append(title, close);

    const list = document.createElement('div');
    list.className = 'theia-mobile-sticky-composer-sheet-list';
    for (const mode of options.modes) {
        list.append(ctx.createModeSheetOption(
            mode.name,
            mode.id,
            options.selectedModeId,
            id => {
                options.onSelect(id);
            },
        ));
    }

    panel.append(header, list);
    const root = ctx.mountModeSheetPresentation(panel, {
        anchor: options.anchor,
        transcriptOverlay: options.transcriptOverlay,
        onClose: options.onClose,
    });
    document.body.append(root);
    options.assignSheet(root);
}

export function openStickyComposerModeSheetExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext, project: MobileProjectEntry,
    modes: readonly ChatMode[],
    anchor?: HTMLElement,): void {
    const cwd = ctx.host.projectsService.getProjectCwd(project) ?? ctx.host.preparedCwdByProjectId.get(project.id);
    ctx.openComposerModeSheet({
        modes,
        selectedModeId: ctx.host.stickyComposerModeId,
        cwd,
        anchor,
        transcriptOverlay: ctx.shouldElevateComposerSheets(),
        closeTitle: nls.localize('qaap/mobileAgentComposer/close', 'Close'),
        onClose: () => ctx.closeAllComposerSheets(),
        isOpen: () => ctx.host.stickyComposerModeSheet !== undefined,
        assignSheet: sheet => { ctx.host.stickyComposerModeSheet = sheet; },
        onSelect: id => {
            ctx.host.stickyComposerModeId = id;
            if (cwd) {
                writeStoredComposerMode(cwd, id);
            }
            ctx.closeAllComposerSheets();
            ctx.host.stickyComposerRenderUi.renderStickyComposer();
        },
    });
}

export function openStickyComposerApprovalPolicySheetExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext, project: MobileProjectEntry,
    agentLabel: string,
    anchor?: HTMLElement,): void {
    const cwd = ctx.host.projectsService.getProjectCwd(project) ?? ctx.host.preparedCwdByProjectId.get(project.id);
    ctx.openApprovalPolicySheet({
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
    let selectedId = options.selectedId;
    let mountedRoot: HTMLElement | undefined;
    const syncPopover = (): void => {
        if (mountedRoot) {
            window.requestAnimationFrame(() => ctx.syncApprovalPolicyPopoverPosition(mountedRoot));
        }
    };
    const policyButtons: HTMLButtonElement[] = [];
    for (const policy of QAAP_AGENT_APPROVAL_POLICIES) {
        const button = createApprovalPolicySheetOptionButton({
            policy,
            selected: policy.id === selectedId,
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

export function createModeSheetOptionExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext, label: string,
    modeId: string,
    selectedModeId: string | undefined,
    onSelect: (modeId: string) => void,): HTMLElement {
    return createModeSheetOptionButton({
        modeId,
        label,
        selected: selectedModeId === modeId,
        onSelect: () => {
            onSelect(modeId);
        },
    });
}

export function createAgentSheetOptionExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext, label: string,
    agentId: string,
    cwd: string | undefined,
    selectedAgentId: string | undefined,
    onSelect: (agentId: string) => void,): HTMLElement {
    return createAgentSheetOptionButton({
        agentId,
        label,
        selected: isStickyComposerAgentSelected(agentId, selectedAgentId, cwd),
        onSelect: () => onSelect(agentId),
    });
}

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
        return { models, loadFailed: false };
    } catch {
        return { models: [], loadFailed: true };
    }
}
