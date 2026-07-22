// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { prefersReducedMotion } from '../common/qaap-prefers-reduced-motion';
import {
    resolveCapabilityLevelLabel,
    type ModelCapabilityLevelValue,
} from '../common/qaap-sticky-composer-model-capability';
import { createModelCapabilitySlider } from './model-capability-slider';

export interface ModelCapabilityPopoverPanelOptions {
    readonly level: ModelCapabilityLevelValue;
    readonly onCommit: (level: ModelCapabilityLevelValue) => void;
    readonly onAdvancedClick?: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Lucide-style zap outline — stroke-friendly for draw/reveal. */
const MODEL_CAPABILITY_ZAP_PATH = 'M13 2 3 14h9l-1 8 10-12h-9l1-8z';
export const MODEL_CAPABILITY_ZAP_STRIKE_CLASS = 'theia-mod-zap-strike';

function formatModelCapabilityEffortLabel(level: ModelCapabilityLevelValue): string {
    return nls.localize(
        'qaap/mobileProjects/modelCapabilityEffort',
        'Effort: {0}',
        resolveCapabilityLevelLabel(level),
    );
}

export function createModelCapabilityZapIcon(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('qaap-model-capability-popover-bolt');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', MODEL_CAPABILITY_ZAP_PATH);
    path.setAttribute('pathLength', '1');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.85');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.classList.add('qaap-model-capability-popover-bolt-path');
    svg.append(path);
    return svg;
}

export function playModelCapabilityZapStrike(bolt: Element): void {
    if (prefersReducedMotion()) {
        return;
    }
    bolt.classList.remove(MODEL_CAPABILITY_ZAP_STRIKE_CLASS);
    // Restart CSS animation when the class is re-applied on consecutive level changes.
    void (bolt as SVGElement).getBoundingClientRect();
    bolt.classList.add(MODEL_CAPABILITY_ZAP_STRIKE_CLASS);
}

export function renderModelCapabilityPopoverPanel(options: ModelCapabilityPopoverPanelOptions): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'qaap-model-capability-popover-panel';

    const header = document.createElement('div');
    header.className = 'qaap-model-capability-popover-header';

    const advancedBtn = document.createElement('button');
    advancedBtn.type = 'button';
    advancedBtn.className = 'qaap-model-capability-popover-advanced';
    const advancedLabel = document.createElement('span');
    advancedLabel.className = 'qaap-model-capability-popover-advanced-label';
    const syncEffortLabel = (level: ModelCapabilityLevelValue): void => {
        const label = formatModelCapabilityEffortLabel(level);
        advancedLabel.textContent = label;
        advancedBtn.setAttribute('aria-label', label);
    };
    syncEffortLabel(options.level);
    const advancedChevron = document.createElement('span');
    advancedChevron.className = 'codicon codicon-chevron-right qaap-model-capability-popover-advanced-chevron';
    advancedChevron.setAttribute('aria-hidden', 'true');
    advancedBtn.append(advancedLabel, advancedChevron);
    if (options.onAdvancedClick) {
        advancedBtn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            options.onAdvancedClick?.();
        });
    } else {
        advancedBtn.disabled = true;
    }

    const bolt = createModelCapabilityZapIcon();
    let animatedLevel = options.level;
    const syncEffortLevel = (level: ModelCapabilityLevelValue): void => {
        syncEffortLabel(level);
        if (level === animatedLevel) {
            return;
        }
        animatedLevel = level;
        playModelCapabilityZapStrike(bolt);
    };

    header.append(advancedBtn, bolt);

    const body = document.createElement('div');
    body.className = 'qaap-model-capability-popover-body';

    const slider = createModelCapabilitySlider({
        level: options.level,
        onPreview: syncEffortLevel,
        onCommit: level => {
            syncEffortLevel(level);
            options.onCommit(level);
        },
    });
    body.append(slider.root);

    panel.append(header, body);
    return panel;
}

export function populateModelCapabilityToolbarButton(
    button: HTMLButtonElement,
    options: {
        readonly level: ModelCapabilityLevelValue;
    },
): void {
    button.replaceChildren();
    const bolt = document.createElement('span');
    bolt.className = 'codicon codicon-zap theia-mobile-projects-sticky-composer-model-capability-bolt';
    bolt.setAttribute('aria-hidden', 'true');
    const level = document.createElement('span');
    level.className = 'theia-mobile-projects-sticky-composer-model-capability-level';
    level.textContent = resolveCapabilityLevelLabel(options.level);
    const chevron = document.createElement('span');
    chevron.className = 'codicon codicon-chevron-down theia-mobile-projects-sticky-composer-model-capability-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    button.append(bolt, level, chevron);

    const levelLabel = resolveCapabilityLevelLabel(options.level);
    const title = nls.localize(
        'qaap/mobileProjects/modelCapabilityTrigger',
        'Model capability: {0}',
        levelLabel,
    );
    button.title = title;
    button.setAttribute('aria-label', title);
}
