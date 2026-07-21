// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { appendAgentBrandIcon, createAgentBrandIcon, resolveAgentBrand } from '../common/qaap-agent-branding';
import type { MobileProjectTaskVerification } from './mobile-projects-active-tasks';
import { appendLlmProviderIcon } from '../common/qaap-llm-provider-branding';
import { formatQaiqModelIdShortLabel } from '../common/qaap-qaiq-model-catalog';
import type { QaapAgentApprovalPolicyOption } from '../common/qaap-sticky-composer-approval-policy';
import type { QaapComposerInteractionModeId } from '../common/qaap-sticky-composer-mode';

export type QaapAgentUiSize = 'sm' | 'md';

export interface QaapAgentOption {
    readonly id: string;
    readonly label: string;
}

export interface QaapAgentChipOptions {
    readonly agentId: string;
    readonly label?: string;
    readonly selected?: boolean;
    readonly disabled?: boolean;
    readonly onClick?: () => void;
}

export interface QaapAgentPickerController {
    readonly root: HTMLElement;
    readonly hiddenInput: HTMLInputElement;
    getSelectedId(): string;
    setSelectedId(agentId: string): void;
    setAgents(agents: readonly QaapAgentOption[]): void;
}

export interface QaapAgentSelectFieldController {
    readonly root: HTMLElement;
    readonly select: HTMLSelectElement;
    getSelectedId(): string;
    setAgents(agents: readonly QaapAgentOption[], selectedId: string | undefined): void;
}

export function resolveAgentDisplayLabel(agentId: string, fallbackLabel?: string): string {
    return resolveAgentBrand(agentId)?.label ?? fallbackLabel ?? agentId;
}

/** Toggle or static chip with brand icon + label. */
export function createAgentBrandChip(options: QaapAgentChipOptions): HTMLElement {
    const label = options.label ?? resolveAgentDisplayLabel(options.agentId);
    const el = options.onClick ? document.createElement('button') : document.createElement('span');
    el.className = 'theia-qaap-agent-chip';
    if (options.onClick) {
        (el as HTMLButtonElement).type = 'button';
    }
    if (options.selected) {
        el.classList.add('theia-mod-selected');
    }
    if (options.disabled) {
        el.classList.add('theia-mod-disabled');
        if (options.onClick) {
            (el as HTMLButtonElement).disabled = true;
        }
    }
    appendAgentBrandIcon(el, options.agentId, 'sm');
    const text = document.createElement('span');
    text.className = 'theia-qaap-agent-chip-label';
    text.textContent = label;
    el.append(text);
    if (options.onClick) {
        el.setAttribute('aria-pressed', String(!!options.selected));
    }
    if (options.onClick && !options.disabled) {
        el.addEventListener('click', options.onClick);
    }
    return el;
}

export interface QaapAgentBrandSplitChipOptions {
    readonly agentId: string;
    readonly label?: string;
    readonly modelLabel?: string;
    readonly selected?: boolean;
    readonly disabled?: boolean;
    readonly menuExpanded?: boolean;
    readonly onToggle: () => void;
    readonly onOpenModelMenu?: (anchor: HTMLElement) => void;
}

/** Split chip: main toggle + optional trailing model menu button. */
export function createAgentBrandSplitChip(options: QaapAgentBrandSplitChipOptions): HTMLElement {
    const label = options.label ?? resolveAgentDisplayLabel(options.agentId);
    // Keep the main face the same size as a plain chip; model belongs in title/aria, not the label.
    const group = document.createElement('div');
    group.className = 'theia-qaap-agent-chip-group';
    group.setAttribute('role', 'group');
    const groupLabel = options.modelLabel ? `${label} · ${options.modelLabel}` : label;
    group.setAttribute('aria-label', groupLabel);
    if (options.modelLabel) {
        group.title = groupLabel;
    }
    if (options.selected) {
        group.classList.add('theia-mod-selected');
    }
    if (options.disabled) {
        group.classList.add('theia-mod-disabled');
    }

    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'theia-qaap-agent-chip-main';
    mainBtn.setAttribute('aria-pressed', String(!!options.selected));
    mainBtn.setAttribute(
        'aria-label',
        options.selected
            ? nls.localize('qaap/mobileProjects/parallelAgentSelected', '{0}, selected', label)
            : label,
    );
    if (options.disabled) {
        mainBtn.disabled = true;
    }
    appendAgentBrandIcon(mainBtn, options.agentId, 'sm');
    const text = document.createElement('span');
    text.className = 'theia-qaap-agent-chip-label';
    text.textContent = label;
    mainBtn.append(text);
    if (!options.disabled) {
        mainBtn.addEventListener('click', options.onToggle);
    }
    group.append(mainBtn);

    if (options.onOpenModelMenu) {
        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'theia-qaap-agent-chip-menu';
        menuBtn.setAttribute('aria-haspopup', 'menu');
        menuBtn.setAttribute('aria-expanded', String(!!options.menuExpanded));
        menuBtn.setAttribute(
            'aria-label',
            options.modelLabel
                ? nls.localize(
                    'qaap/mobileProjects/parallelChooseModelWithCurrent',
                    'Choose model for {0}, current {1}',
                    label,
                    options.modelLabel,
                )
                : nls.localize('qaap/mobileProjects/stickyComposerPickModelForAgent', 'Choose model for {0}', label),
        );
        if (options.disabled) {
            menuBtn.disabled = true;
        }
        const chevron = document.createElement('span');
        chevron.className = 'codicon codicon-chevron-down';
        chevron.setAttribute('aria-hidden', 'true');
        menuBtn.append(chevron);
        if (!options.disabled) {
            menuBtn.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                options.onOpenModelMenu!(menuBtn);
            });
        }
        group.append(menuBtn);
    }

    return group;
}

/** Bottom-sheet row for agent pickers. */
export function createAgentSheetOptionButton(options: {
    readonly agentId: string;
    readonly label: string;
    readonly selected?: boolean;
    readonly submenuChevron?: 'collapsed' | 'expanded' | 'forward';
    readonly onSelect: () => void;
}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theia-mobile-sticky-composer-sheet-option theia-qaap-agent-sheet-option';
    if (options.selected) {
        btn.classList.add('theia-mod-selected');
    }
    const content = document.createElement('span');
    content.className = 'theia-mobile-sticky-composer-sheet-option-content';
    appendAgentBrandIcon(content, options.agentId, 'sm');
    const labelEl = document.createElement('span');
    labelEl.className = 'theia-mobile-sticky-composer-sheet-option-label';
    labelEl.textContent = options.label;
    content.append(labelEl);
    if (options.selected) {
        const check = document.createElement('span');
        check.className = 'codicon codicon-check theia-mobile-sticky-composer-sheet-option-check';
        check.setAttribute('aria-hidden', 'true');
        content.append(check);
    }
    if (options.submenuChevron) {
        const chevron = document.createElement('span');
        const icon = options.submenuChevron === 'expanded'
            ? 'codicon-chevron-down'
            : 'codicon-chevron-right';
        chevron.className = `codicon ${icon} theia-mobile-sticky-composer-sheet-option-chevron`;
        chevron.setAttribute('aria-hidden', 'true');
        content.append(chevron);
    }
    btn.append(content);
    btn.addEventListener('click', event => {
        event.stopPropagation();
        options.onSelect();
    });
    return btn;
}

/** Agent approval policy row (icon + title + description + optional check). */
export function createApprovalPolicySheetOptionButton(options: {
    readonly policy: QaapAgentApprovalPolicyOption;
    readonly selected?: boolean;
    readonly onSelect: () => void;
}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theia-mobile-sticky-composer-sheet-option theia-qaap-approval-policy-sheet-option';
    if (options.selected) {
        btn.classList.add('theia-mod-selected');
    }
    const content = document.createElement('span');
    content.className = 'theia-mobile-sticky-composer-sheet-option-content theia-qaap-approval-policy-sheet-option-content';

    const iconHost = document.createElement('span');
    iconHost.className = 'theia-qaap-approval-policy-sheet-icon';
    const icon = document.createElement('span');
    icon.className = `codicon ${options.policy.sheetIconClass}`;
    icon.setAttribute('aria-hidden', 'true');
    iconHost.append(icon);
    content.append(iconHost);

    const text = document.createElement('span');
    text.className = 'theia-qaap-approval-policy-sheet-text';
    const labelEl = document.createElement('span');
    labelEl.className = 'theia-qaap-approval-policy-sheet-label';
    labelEl.textContent = options.policy.label;
    const descriptionEl = document.createElement('span');
    descriptionEl.className = 'theia-qaap-approval-policy-sheet-description';
    descriptionEl.textContent = options.policy.description;
    text.append(labelEl, descriptionEl);
    content.append(text);

    if (options.selected) {
        const check = document.createElement('span');
        check.className = 'codicon codicon-check theia-mobile-sticky-composer-sheet-option-check';
        check.setAttribute('aria-hidden', 'true');
        content.append(check);
    }

    btn.append(content);
    btn.addEventListener('click', options.onSelect);
    return btn;
}

/** Toggle row for granular tool scopes under the approve-for-me preset. */
export function createToolApprovalRuleToggle(options: {
    readonly label: string;
    readonly description: string;
    readonly checked: boolean;
    readonly disabled?: boolean;
    readonly onChange: (checked: boolean) => void;
}): HTMLLabelElement {
    const row = document.createElement('label');
    row.className = 'theia-mobile-sticky-composer-sheet-option theia-qaap-tool-approval-rule';
    if (options.disabled) {
        row.classList.add('theia-mod-disabled');
    }
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = options.checked;
    input.disabled = options.disabled === true;
    input.addEventListener('change', () => options.onChange(input.checked));
    const text = document.createElement('span');
    text.className = 'theia-qaap-tool-approval-rule-text';
    const labelEl = document.createElement('span');
    labelEl.className = 'theia-qaap-tool-approval-rule-label';
    labelEl.textContent = options.label;
    const descriptionEl = document.createElement('span');
    descriptionEl.className = 'theia-qaap-tool-approval-rule-description';
    descriptionEl.textContent = options.description;
    text.append(labelEl, descriptionEl);
    row.append(input, text);
    return row;
}

/** Sticky composer approval trigger — icon + label + chevron. */
export function populateApprovalPolicyToolbarButton(
    button: HTMLButtonElement,
    policy: QaapAgentApprovalPolicyOption,
): void {
    button.replaceChildren();
    const icon = document.createElement('span');
    icon.className = `codicon ${policy.toolbarIconClass} theia-qaap-approval-policy-toolbar-icon`;
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'theia-mobile-projects-sticky-composer-approval-policy-label';
    label.textContent = policy.label;
    const chevron = document.createElement('span');
    chevron.className = 'codicon codicon-chevron-down';
    chevron.setAttribute('aria-hidden', 'true');
    button.append(icon, label, chevron);
}

/** Picker row for model lists (optional LLM provider icon). */
export function createPickerSheetOptionButton(options: {
    readonly label: string;
    readonly selected?: boolean;
    readonly llmVendor?: string;
    readonly llmModelId?: string;
    /** Muted observed-latency chip, e.g. `~2m 10s` (see `qaap-model-latency-stats.ts`). */
    readonly statsLabel?: string;
    /** Renders {@link statsLabel} in the warning color to flag models with a slow observed median. */
    readonly statsSlow?: boolean;
    /** Capability pill after the label, e.g. `No tools` for models without function calling. */
    readonly badgeLabel?: string;
    /** Renders {@link badgeLabel} in the warning treatment. */
    readonly badgeWarning?: boolean;
    readonly menuItem?: boolean;
    readonly onSelect: () => void;
}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theia-mobile-sticky-composer-sheet-option theia-qaap-picker-sheet-option';
    if (options.menuItem) {
        btn.setAttribute('role', 'menuitem');
    }
    if (options.selected) {
        btn.classList.add('theia-mod-selected');
    }
    const content = document.createElement('span');
    content.className = 'theia-mobile-sticky-composer-sheet-option-content';
    if (options.llmVendor) {
        appendLlmProviderIcon(content, options.llmVendor, options.llmModelId, 'sm');
    }
    const labelEl = document.createElement('span');
    labelEl.className = 'theia-mobile-sticky-composer-sheet-option-label';
    labelEl.textContent = options.label;
    content.append(labelEl);
    if (options.badgeLabel) {
        const badge = document.createElement('span');
        badge.className = 'theia-qaap-picker-sheet-option-badge';
        if (options.badgeWarning) {
            badge.classList.add('theia-mod-warning');
        }
        badge.textContent = options.badgeLabel;
        content.append(badge);
    }
    if (options.statsLabel) {
        const stats = document.createElement('span');
        stats.className = 'theia-qaap-picker-sheet-option-stats';
        if (options.statsSlow) {
            stats.classList.add('theia-mod-slow');
        }
        stats.textContent = options.statsLabel;
        content.append(stats);
    }
    if (options.selected) {
        const check = document.createElement('span');
        check.className = 'codicon codicon-check theia-mobile-sticky-composer-sheet-option-check';
        check.setAttribute('aria-hidden', 'true');
        content.append(check);
    }
    btn.append(content);
    btn.addEventListener('click', options.onSelect);
    return btn;
}

const STICKY_COMPOSER_MODE_ICON_PATHS: Readonly<Record<QaapComposerInteractionModeId, readonly string[]>> = {
    agent: ['M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8'],
    plan: [
        'M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4',
        'M2 6h4',
        'M2 10h4',
        'M2 14h4',
        'M2 18h4',
        'M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z',
    ],
    ask: [
        'M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
        'M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1',
    ],
};

function isQaapComposerInteractionModeId(modeId: string): modeId is QaapComposerInteractionModeId {
    return modeId === 'agent' || modeId === 'plan' || modeId === 'ask';
}

function appendStickyComposerModeIconSvg(host: HTMLElement, paths: readonly string[]): void {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('focusable', 'false');
    for (const d of paths) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.append(path);
    }
    host.append(svg);
}

/** Lucide mode glyphs for Agent / Plan / Ask (`currentColor`, 16×16). */
export function createStickyComposerModeIcon(modeId: string): HTMLElement | undefined {
    if (!isQaapComposerInteractionModeId(modeId)) {
        return undefined;
    }
    const host = document.createElement('span');
    host.className = 'theia-qaap-mode-sheet-icon';
    host.setAttribute('aria-hidden', 'true');
    appendStickyComposerModeIconSvg(host, STICKY_COMPOSER_MODE_ICON_PATHS[modeId]);
    return host;
}

/** Bottom-sheet row for interaction mode pickers (icon + label + optional check). */
export function createModeSheetOptionButton(options: {
    readonly modeId: string;
    readonly label: string;
    readonly selected?: boolean;
    readonly onSelect: () => void;
}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theia-mobile-sticky-composer-sheet-option theia-qaap-mode-sheet-option';
    if (options.selected) {
        btn.classList.add('theia-mod-selected');
    }
    const content = document.createElement('span');
    content.className = 'theia-mobile-sticky-composer-sheet-option-content';
    const icon = createStickyComposerModeIcon(options.modeId);
    if (icon) {
        content.append(icon);
    }
    const labelEl = document.createElement('span');
    labelEl.className = 'theia-mobile-sticky-composer-sheet-option-label';
    labelEl.textContent = options.label;
    content.append(labelEl);
    if (options.selected) {
        const check = document.createElement('span');
        check.className = 'codicon codicon-check theia-mobile-sticky-composer-sheet-option-check';
        check.setAttribute('aria-hidden', 'true');
        content.append(check);
    }
    btn.append(content);
    btn.addEventListener('click', event => {
        event.stopPropagation();
        options.onSelect();
    });
    return btn;
}

/** Sticky composer toolbar mode button — Lucide icon + label + chevron. */
export function populateModeToolbarButton(
    button: HTMLButtonElement,
    options: {
        readonly modeId: string;
        readonly label: string;
    },
): void {
    button.replaceChildren();
    const icon = createStickyComposerModeIcon(options.modeId);
    if (icon) {
        button.append(icon);
    }
    const label = document.createElement('span');
    label.className = 'theia-mobile-projects-sticky-composer-mode-label';
    label.textContent = options.label;
    const chevron = document.createElement('span');
    chevron.className = 'codicon codicon-chevron-down';
    chevron.setAttribute('aria-hidden', 'true');
    button.append(label, chevron);
}

/** Sticky composer toolbar agent button — brand icon + provider badge + short model name (agent name is aria/title only). */
export function populateAgentToolbarButton(
    button: HTMLButtonElement,
    options: {
        readonly agentId: string;
        readonly label: string;
        readonly agentModel?: { readonly vendor: string; readonly modelId: string };
    },
): void {
    button.replaceChildren();
    const chevron = document.createElement('span');
    chevron.className = 'codicon codicon-chevron-down';
    chevron.setAttribute('aria-hidden', 'true');
    const modelId = options.agentModel?.modelId?.trim();
    if (modelId) {
        const identity = document.createElement('span');
        identity.className = 'theia-mobile-projects-sticky-composer-agent-identity';

        const avatar = document.createElement('span');
        avatar.className = 'theia-mobile-projects-sticky-composer-agent-avatar';
        appendAgentBrandIcon(avatar, options.agentId, 'sm');
        const badge = document.createElement('span');
        badge.className = 'theia-mobile-projects-sticky-composer-agent-provider-badge';
        if (appendLlmProviderIcon(badge, options.agentModel!.vendor, options.agentModel!.modelId, 'sm')) {
            avatar.append(badge);
        }
        identity.append(avatar);

        const labelEl = document.createElement('span');
        labelEl.className = 'theia-mobile-projects-sticky-composer-agent-label';
        labelEl.textContent = formatQaiqModelIdShortLabel(modelId);
        identity.append(labelEl, chevron);
        button.append(identity);
        button.classList.remove('theia-mod-logo-only');
    } else {
        appendAgentBrandIcon(button, options.agentId, 'sm');
        button.append(chevron);
        button.classList.add('theia-mod-logo-only');
    }
}

/** Task foot / inbox agent badge. */
export function createAgentTaskBadge(options: {
    readonly agentId: string;
    readonly label: string;
    readonly labelColor?: string;
}): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'theia-mobile-projects-task-agent theia-qaap-agent-task-badge';
    appendAgentBrandIcon(badge, options.agentId, 'sm');
    const text = document.createElement('span');
    text.className = 'theia-mobile-projects-task-agent-label';
    if (options.labelColor) {
        text.style.color = options.labelColor;
    }
    text.textContent = options.label;
    badge.append(text);
    return badge;
}

/**
 * Task-foot badge for the backend self-verification result. Renders a green "Checks passed" or red
 * "Checks failed" chip; returns `undefined` for skipped/absent verification so callers can omit it.
 * The failed chip's tooltip carries the failing command + summary.
 */
export function createAgentTaskVerificationBadge(verification?: MobileProjectTaskVerification): HTMLElement | undefined {
    if (!verification || verification.status === 'skipped') {
        return undefined;
    }
    const passed = verification.status === 'passed';
    const badge = document.createElement('span');
    badge.className = `theia-qaap-agent-task-verify-badge ${passed ? 'theia-mod-passed' : 'theia-mod-failed'}`;
    const icon = document.createElement('span');
    icon.className = `codicon ${passed ? 'codicon-pass' : 'codicon-error'}`;
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'theia-qaap-agent-task-verify-badge-label';
    text.textContent = passed
        ? nls.localize('qaap/mobileProjects/verifyChecksPassed', 'Checks passed')
        : nls.localize('qaap/mobileProjects/verifyChecksFailed', 'Checks failed');
    badge.append(icon, text);
    badge.title = passed
        ? nls.localize('qaap/mobileProjects/verifyChecksPassedTip', 'Backend self-verification passed: {0}', verification.command)
        : nls.localize('qaap/mobileProjects/verifyChecksFailedTip', 'Backend self-verification failed ({0}): {1}',
            verification.command, verification.summary);
    return badge;
}

/** Inline meta badge (team hub subtitle, routine cards). */
export function createAgentMetaBadge(agentId: string, label?: string): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'theia-qaap-agent-meta-badge';
    appendAgentBrandIcon(badge, agentId, 'sm');
    const text = document.createElement('span');
    text.className = 'theia-qaap-agent-meta-badge-label';
    text.textContent = label ?? resolveAgentDisplayLabel(agentId);
    badge.append(text);
    return badge;
}

/** Team hub row avatar — brand icon with optional activity ring. */
export function createAgentRowAvatar(options: {
    readonly agentId: string;
    readonly state: 'running' | 'streaming' | 'failed' | 'idle';
    readonly nested?: boolean;
}): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = `theia-qaap-agent-row-avatar theia-mod-${options.state}`;
    if (options.nested) {
        wrap.classList.add('theia-mod-nested');
    }
    const icon = createAgentBrandIcon(options.agentId, options.nested ? 'sm' : 'md');
    if (icon) {
        wrap.append(icon);
    }
    if (options.state === 'running' || options.state === 'streaming') {
        const ring = document.createElement('span');
        ring.className = 'theia-qaap-agent-row-avatar-ring';
        ring.setAttribute('aria-hidden', 'true');
        wrap.append(ring);
    }
    return wrap;
}

/** Visual chip grid picker for forms (routines, parallel runs). */
export function createAgentPickerField(options: {
    readonly label?: string;
    readonly agents: readonly QaapAgentOption[];
    readonly selectedId: string | undefined;
    readonly onChange?: (agentId: string) => void;
}): QaapAgentPickerController {
    const root = document.createElement('div');
    root.className = 'theia-qaap-agent-picker-field';

    if (options.label) {
        const labelEl = document.createElement('div');
        labelEl.className = 'theia-qaap-agent-picker-label';
        labelEl.textContent = options.label;
        root.append(labelEl);
    }

    const chipsHost = document.createElement('div');
    chipsHost.className = 'theia-qaap-agent-picker-chips';

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.name = 'qaap-agent-id';

    let agents = [...options.agents];
    let selectedId = options.selectedId ?? agents[0]?.id ?? '';
    hiddenInput.value = selectedId;

    const renderChips = (): void => {
        chipsHost.replaceChildren();
        if (agents.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'theia-qaap-agent-picker-empty';
            empty.textContent = '—';
            chipsHost.append(empty);
            return;
        }
        for (const agent of agents) {
            chipsHost.append(createAgentBrandChip({
                agentId: agent.id,
                label: agent.label,
                selected: agent.id === selectedId,
                onClick: () => {
                    selectedId = agent.id;
                    hiddenInput.value = selectedId;
                    renderChips();
                    options.onChange?.(selectedId);
                },
            }));
        }
    };

    renderChips();
    root.append(chipsHost, hiddenInput);

    return {
        root,
        hiddenInput,
        getSelectedId: () => selectedId,
        setSelectedId: agentId => {
            selectedId = agentId;
            hiddenInput.value = agentId;
            renderChips();
        },
        setAgents: nextAgents => {
            agents = [...nextAgents];
            if (!agents.some(a => a.id === selectedId)) {
                selectedId = agents[0]?.id ?? '';
                hiddenInput.value = selectedId;
            }
            renderChips();
        },
    };
}

/** Compact select + leading icon (mini composer). */
export function createAgentSelectField(options: {
    readonly className?: string;
    readonly ariaLabel: string;
    readonly onChange?: (agentId: string) => void;
}): QaapAgentSelectFieldController {
    const root = document.createElement('div');
    root.className = 'theia-qaap-agent-select-field';

    const iconHost = document.createElement('span');
    iconHost.className = 'theia-qaap-agent-select-icon';

    const select = document.createElement('select');
    select.className = options.className ?? 'theia-qaap-agent-select';
    select.setAttribute('aria-label', options.ariaLabel);

    const syncIcon = (agentId: string): void => {
        iconHost.replaceChildren();
        const icon = createAgentBrandIcon(agentId, 'sm');
        if (icon) {
            iconHost.append(icon);
        }
    };

    select.addEventListener('change', () => {
        syncIcon(select.value);
        options.onChange?.(select.value);
    });

    root.append(iconHost, select);

    return {
        root,
        select,
        getSelectedId: () => select.value,
        setAgents: (agents, selectedId) => {
            select.replaceChildren();
            for (const agent of agents) {
                const option = document.createElement('option');
                option.value = agent.id;
                option.textContent = agent.label;
                select.append(option);
            }
            const resolved = selectedId && agents.some(a => a.id === selectedId)
                ? selectedId
                : (agents[0]?.id ?? '');
            select.value = resolved;
            select.hidden = agents.length <= 1;
            select.disabled = agents.length <= 1;
            iconHost.hidden = agents.length <= 1;
            syncIcon(resolved);
        },
    };
}

export function appendSubtitleMetaPart(parent: HTMLElement, part: HTMLElement | string): void {
    if (parent.childElementCount > 0) {
        const sep = document.createElement('span');
        sep.className = 'theia-qaap-agent-meta-sep';
        sep.textContent = '·';
        sep.setAttribute('aria-hidden', 'true');
        parent.append(sep);
    }
    if (typeof part === 'string') {
        const text = document.createElement('span');
        text.className = 'theia-qaap-agent-meta-text';
        text.textContent = part;
        parent.append(text);
    } else {
        parent.append(part);
    }
}

/** Mockup-style diff stats (+128 −18). */
export function createDiffStatsLine(options: {
    readonly added?: number;
    readonly removed?: number;
    readonly fileCount?: number;
}): HTMLElement {
    const line = document.createElement('span');
    line.className = 'theia-qaap-diff-stats';
    const parts: HTMLElement[] = [];
    if ((options.added ?? 0) > 0 || (options.removed ?? 0) > 0) {
        const added = document.createElement('span');
        added.className = 'theia-qaap-diff-stats-added';
        added.textContent = `+${options.added ?? 0}`;
        parts.push(added);
        const removed = document.createElement('span');
        removed.className = 'theia-qaap-diff-stats-removed';
        removed.textContent = `−${options.removed ?? 0}`;
        parts.push(removed);
    }
    if ((options.fileCount ?? 0) > 0) {
        const files = document.createElement('span');
        files.className = 'theia-qaap-diff-stats-files';
        files.textContent = `${options.fileCount} files`;
        parts.push(files);
    }
    if (parts.length === 0) {
        line.textContent = '—';
        return line;
    }
    for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
            const sep = document.createElement('span');
            sep.className = 'theia-qaap-diff-stats-sep';
            sep.textContent = ' ';
            line.append(sep);
        }
        line.append(parts[i]);
    }
    return line;
}

/** Parallel run variant card. */
export function createParallelVariantCard(options: {
    readonly agentId: string;
    readonly title: string;
    readonly meta?: HTMLElement | string;
    readonly state: 'running' | 'failed' | 'idle';
    readonly selected?: boolean;
    readonly chooseLabel?: string;
    readonly chooseDisabled?: boolean;
    readonly onChoose?: () => void;
}): HTMLElement {
    const row = document.createElement('div');
    row.className = 'theia-qaap-parallel-variant-card';
    if (options.selected) {
        row.classList.add('theia-mod-selected');
    }
    row.append(createAgentRowAvatar({
        agentId: options.agentId,
        state: options.state === 'idle' ? 'idle' : options.state === 'failed' ? 'failed' : 'running',
    }));
    const body = document.createElement('div');
    body.className = 'theia-qaap-parallel-variant-body';
    const title = document.createElement('div');
    title.className = 'theia-qaap-parallel-variant-title';
    title.textContent = options.title;
    const meta = document.createElement('div');
    meta.className = 'theia-qaap-parallel-variant-meta';
    if (typeof options.meta === 'string') {
        meta.textContent = options.meta;
    } else if (options.meta) {
        meta.append(options.meta);
    } else {
        meta.textContent = '—';
    }
    body.append(title, meta);
    row.append(body);
    if (options.onChoose) {
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.className = 'theia-qaap-parallel-variant-choose';
        choose.textContent = options.chooseLabel ?? 'Choose';
        choose.disabled = options.chooseDisabled ?? false;
        choose.addEventListener('click', ev => {
            ev.stopPropagation();
            options.onChoose?.();
        });
        row.append(choose);
    }
    return row;
}
