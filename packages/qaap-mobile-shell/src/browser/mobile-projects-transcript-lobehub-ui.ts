// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type LobeTraceStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'warning';

export interface LobeToolTitleParam {
    readonly key: string;
    readonly value: string;
}

export interface LobeToolTitleOptions {
    readonly pluginTitle: string;
    readonly apiName: string;
    readonly loading?: boolean;
    readonly aborted?: boolean;
    readonly params?: readonly LobeToolTitleParam[];
    readonly remainingParamsCount?: number;
}

const LOBE_MAX_PARAMS = 1;
const LOBE_MAX_PARAM_VALUE_LENGTH = 50;

function truncateLobeParamValue(value: string): string {
    return value.length <= LOBE_MAX_PARAM_VALUE_LENGTH
        ? value
        : `${value.slice(0, LOBE_MAX_PARAM_VALUE_LENGTH)}...`;
}

export function parseLobeToolTitleParams(raw: string | undefined): LobeToolTitleParam[] {
    return parseLobeToolTitleParamSummary(raw).params;
}

export function parseLobeToolTitleParamSummary(raw: string | undefined): {
    readonly params: LobeToolTitleParam[];
    readonly remainingParamsCount: number;
} {
    if (!raw?.trim()) {
        return { params: [], remainingParamsCount: 0 };
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { params: [], remainingParamsCount: 0 };
        }
        const entries = Object.entries(parsed as Record<string, unknown>);
        return {
            params: entries
            .slice(0, LOBE_MAX_PARAMS)
            .map(([key, value]) => ({
                key,
                value: truncateLobeParamValue(formatLobeToolParamValue(value)),
            })),
            remainingParamsCount: Math.max(0, entries.length - LOBE_MAX_PARAMS),
        };
    } catch {
        return { params: [], remainingParamsCount: 0 };
    }
}

function formatLobeToolParamValue(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (value === null || value === undefined) {
        return String(value);
    }
    return JSON.stringify(value);
}

export function createLobeTraceStatusIndicator(status: LobeTraceStatus, kind?: string): HTMLElement {
    const block = document.createElement('span');
    block.className = `theia-mobile-agent-lobe-status-indicator theia-mobile-agent-shadcn-status-indicator theia-mod-${status}`;
    if (kind) {
        block.classList.add(`theia-mod-${kind}`);
    }
    block.setAttribute('role', 'status');
    block.setAttribute('aria-label', status);
    const icon = document.createElement('span');
    icon.className = 'theia-mobile-agent-lobe-status-icon theia-mobile-agent-shadcn-status-icon';
    icon.setAttribute('aria-hidden', 'true');
    if (status === 'running') {
        icon.classList.add('theia-mod-neural-loading');
        icon.append(createLobeNeuralLoadingDot(), createLobeNeuralLoadingDot(), createLobeNeuralLoadingDot());
    } else {
        icon.append(createLobeStatusSvg(status));
    }
    block.append(icon);
    return block;
}

function createLobeNeuralLoadingDot(): HTMLElement {
    const dot = document.createElement('span');
    dot.className = 'theia-mobile-agent-lobe-neural-dot theia-mobile-agent-shadcn-loading-dot';
    return dot;
}

function createLobeStatusSvg(status: LobeTraceStatus): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.25');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const pathData of resolveLobeStatusIconPaths(status)) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        svg.append(path);
    }
    return svg;
}

function resolveLobeStatusIconPaths(status: LobeTraceStatus): readonly string[] {
    switch (status) {
        case 'cancelled':
            return ['M10 4H6v16h4V4Z', 'M18 4h-4v16h4V4Z'];
        case 'failed':
            return ['M18 6 6 18', 'm6 6 12 12'];
        case 'pending':
            return ['M18 11V6a2 2 0 0 0-4 0', 'M14 10V4a2 2 0 0 0-4 0v8', 'M10 12V6a2 2 0 0 0-4 0v8', 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-16 0v-2'];
        case 'warning':
            return ['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z', 'M12 9v4', 'M12 17h.01'];
        case 'completed':
        default:
            return ['M20 6 9 17l-5-5'];
    }
}

export function createLobeToolTitle(options: LobeToolTitleOptions): HTMLElement {
    const root = document.createElement('span');
    root.className = 'theia-mobile-agent-lobe-tool-title-root theia-mobile-agent-shadcn-tool-title-root';
    root.classList.toggle('theia-mod-loading', !!options.loading);
    root.classList.toggle('theia-mod-aborted', !!options.aborted);

    const plugin = document.createElement('span');
    plugin.className = 'theia-mobile-agent-lobe-tool-plugin theia-mobile-agent-shadcn-tool-plugin';
    plugin.textContent = options.pluginTitle;
    const chevron = document.createElement('span');
    chevron.className = 'theia-mobile-agent-lobe-tool-title-chevron theia-mobile-agent-shadcn-tool-title-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    const api = document.createElement('span');
    api.className = 'theia-mobile-agent-lobe-tool-api theia-mobile-agent-shadcn-tool-api';
    api.textContent = options.apiName;
    root.append(plugin, chevron, api);

    const params = options.params?.slice(0, LOBE_MAX_PARAMS) ?? [];
    if (params.length > 0) {
        const open = document.createElement('span');
        open.className = 'theia-mobile-agent-lobe-tool-param';
        open.textContent = ' (';
        root.append(open);
        params.forEach((param, index) => {
            const item = document.createElement('span');
            item.className = 'theia-mobile-agent-lobe-tool-param theia-mobile-agent-shadcn-tool-param';
            const key = document.createElement('span');
            key.className = 'theia-mobile-agent-lobe-tool-param-key theia-mobile-agent-shadcn-tool-param-key';
            key.textContent = `${param.key}:`;
            const value = document.createElement('span');
            value.className = 'theia-mobile-agent-lobe-tool-param-value theia-mobile-agent-shadcn-tool-param-value';
            value.textContent = param.value;
            item.append(key, document.createTextNode(' '), value);
            root.append(item);
            if (index < params.length - 1) {
                const comma = document.createElement('span');
                comma.className = 'theia-mobile-agent-lobe-tool-param';
                comma.textContent = ', ';
                root.append(comma);
            }
        });
        if (options.remainingParamsCount && options.remainingParamsCount > 0) {
            const more = document.createElement('span');
            more.className = 'theia-mobile-agent-lobe-tool-param theia-mobile-agent-lobe-tool-param-more';
            more.textContent = ` +${options.remainingParamsCount}`;
            root.append(more);
        }
        const close = document.createElement('span');
        close.className = 'theia-mobile-agent-lobe-tool-param';
        close.textContent = ')';
        root.append(close);
    }
    return root;
}
