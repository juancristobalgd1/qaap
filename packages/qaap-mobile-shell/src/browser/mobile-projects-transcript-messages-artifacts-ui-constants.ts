// @ts-nocheck
// Shared module-level constants extracted from mobile-projects-transcript-messages-artifacts-ui.ts
// These are mutable WeakMap/WeakSet registries and must be shared across all extracted files.

import type { QaapAgentMessageSegmentDTO } from '@theia/qaap-cloud-workspace/lib/common/qaap-agent-conversation';
import type { QaapAgentConversationDTO } from '@theia/qaap-cloud-workspace/lib/common/qaap-agent-conversation';
import type { ToolUmbrella } from '../common/qaap-tool-umbrella';

export interface LazyTranscriptToolPillPayload {
    readonly segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>;
    readonly conv: QaapAgentConversationDTO | undefined;
    readonly kind: string;
    readonly finished: boolean;
    readonly resultFailed: boolean;
}

export const MOBILE_CLOSING_TEXT_ERROR_PREFIX = /^error:\s*/i;

export const TRANSCRIPT_TRACE_STATUS_ATTR = 'data-transcript-trace-status';
export const TRANSCRIPT_CHECKPOINT_RESTORE_ATTR = 'data-transcript-checkpoint-id';

export const transcriptActivityTimelineResync = new WeakMap<HTMLElement, () => void>();
export const transcriptLiveStatusTickerBound = new WeakSet<HTMLElement>();
export const transcriptToolGroupItems = new WeakMap<HTMLElement, Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>[]>();
export const transcriptToolGroupUmbrella = new WeakMap<HTMLElement, ToolUmbrella>();
export const transcriptSummarySpinners = new WeakMap<HTMLElement, HTMLElement>();

export const lazyTranscriptToolPillBodies = new WeakMap<HTMLDetailsElement, LazyTranscriptToolPillPayload>();
