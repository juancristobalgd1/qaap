// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Pure helpers extracted from MobileProjectsTranscriptSurfacesUi.
// These functions operate only on their parameters and do not access instance state.

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { TranscriptTerminalPersistedWorkspace, TranscriptTerminalSurface } from './qaap-transcript-terminal-view';
import {
    normalizeTranscriptWorkspaceKey,
    type TranscriptWorkspaceSurfaceKey,
} from './qaap-transcript-workspace-surfaces-cache';

// ─── Path comparison ─────────────────────────────────────────────────────────

export function pathsEqual(left: string | undefined, right: string | undefined): boolean {
    if (!left || !right) {
        return false;
    }
    const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return normalize(left) === normalize(right);
}

// ─── Conversation meta ───────────────────────────────────────────────────────

export function transcriptConversationMeta(
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
): string {
    const agentLabel = summary.agentId ? `@${summary.agentId.replace(/^@/, '')}` : '';
    return agentLabel ? `${project.name} · ${agentLabel}` : project.name;
}

// ─── Workspace key ───────────────────────────────────────────────────────────

export function resolveProjectScopedWorkspaceKey(
    project: MobileProjectEntry,
    resolvedPath: string,
    conversationId?: string,
): TranscriptWorkspaceSurfaceKey {
    const workspaceKey = normalizeTranscriptWorkspaceKey(resolvedPath);
    const projectKey = project.id.trim() || project.uri?.toString() || project.name || 'unknown-project';
    // Include the conversation/section id so terminals and files are isolated per-section,
    // matching the per-section preview model: each task keeps its own terminal tabs and file
    // mounts, and closing a task releases them without disturbing sibling sections.
    const conversationKey = conversationId?.trim()
        ? `:conv:${encodeURIComponent(conversationId.trim())}`
        : '';
    return `project:${encodeURIComponent(projectKey)}:${workspaceKey}${conversationKey}`;
}

// ─── Terminal tab title ──────────────────────────────────────────────────────

export function resolveTranscriptTerminalTabTitle(surface: TranscriptTerminalSurface, index: number): string {
    const title = surface.terminal.title.label?.trim();
    if (title) {
        return title;
    }
    return nls.localize('qaap/mobileProjects/transcriptTerminalIndex', 'Terminal {0}', String(index + 1));
}

// ─── Persisted terminal workspace ────────────────────────────────────────────

export interface TranscriptTerminalSliderStateLike {
    surfaces: TranscriptTerminalSurface[];
    activeIndex: number;
}

export function toPersistedTerminalWorkspace(
    state: TranscriptTerminalSliderStateLike | undefined,
): TranscriptTerminalPersistedWorkspace | undefined {
    if (!state || state.surfaces.length === 0) {
        return undefined;
    }
    const terminals = state.surfaces
        .map(surface => ({
            terminalId: surface.terminal.terminalId,
            titleLabel: surface.terminal.title.label,
        }))
        .filter(terminal => Number.isInteger(terminal.terminalId) && terminal.terminalId >= 0);
    if (terminals.length === 0) {
        return undefined;
    }
    return {
        activeIndex: Math.min(Math.max(0, state.activeIndex), terminals.length - 1),
        terminals,
    };
}
