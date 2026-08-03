// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Execution Event Timeline types (mobile) ─────────────────────────────────
//
// Pure type definitions and the file-open custom event name shared across the
// execution event timeline modules. Extracted from qaap-execution-event-timeline.ts
// to keep the type contract decoupled from the rendering/patching logic.

import type { QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';

export type MobileEventKind = 'explore' | 'read' | 'write' | 'edit' | 'delete' | 'run' | 'verification' | 'other';

export interface MobileExecutionTool {
    segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>;
    segmentIndex: number;
    kind: MobileEventKind;
    verb: string;
    detail: string;
    filePath?: string;
    isTerminal: boolean;
    isVerification: boolean;
    isError: boolean;
    isFinished: boolean;
}

export interface MobileExecutionEvent {
    id: string;
    narrative: string;
    narrativeSource: 'agent' | 'synthetic';
    kind: MobileEventKind;
    icon: string;
    verb: string;
    tools: MobileExecutionTool[];
    hasPending: boolean;
    hasError: boolean;
}

export interface MobileExecutionTimeline {
    events: MobileExecutionEvent[];
    closingNarrative?: string;
}

export const MOBILE_TOOL_FILE_OPEN_EVENT = 'qaap-mobile-tool-file-open';
