// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `MobileProjectsConversations` and the extracted free functions in the
// `mobile-projects-conversations-*.ts` cluster. Each extracted function receives the host typed as
// `MobileProjectsConversationsContext` instead of `any`. The contract is picked from the class over an explicit member
// list, so every member keeps the exact type the class declares. Members named here are `public`
// (+ `@internal` where they used to be `protected`) on the class.
// `import type` keeps this free of a runtime import cycle (the class imports every extracted module).

import type { MobileProjectsConversations } from './mobile-projects-conversations';

/** Members referenced by the extracted `mobile-projects-conversations-*` modules. */
export type MobileProjectsConversationsContextMember =
    | 'applyConversationGroups'
    | 'cacheDocument'
    | 'cancelConversationLive'
    | 'clearReconnectTimers'
    | 'closeSse'
    | 'closeWebSocket'
    | 'deletedConversationIds'
    | 'dispatchLiveMessage'
    | 'dispatchLiveMessageDelta'
    | 'dispatchServerPayload'
    | 'dispatchSseEvent'
    | 'documentPrefetchInFlight'
    | 'emitConversationChange'
    | 'fileService'
    | 'findSummaryById'
    | 'findTheiaSummary'
    | 'installVisibilityReconnect'
    | 'lastConversationChange'
    | 'lastPrimeFromAllAt'
    | 'liveCancelDispose'
    | 'markStreamingTransports'
    | 'mergeCwdConversationLists'
    | 'onDidChangeDetailEmitter'
    | 'onDidChangeEmitter'
    | 'onDidReceiveMessageEmitter'
    | 'onDidReceiveParallelRunEmitter'
    | 'onDidReceivePendingQueueEmitter'
    | 'onDidReceiveTransportActivityEmitter'
    | 'onDidReconnectTransportEmitter'
    | 'openSseStream'
    | 'openWebSocket'
    | 'perfProbeByCwd'
    | 'prefetchDocument'
    | 'primeFromAll'
    | 'primeFromAllInFlight'
    | 'readJson'
    | 'recordClientStreamMetrics'
    | 'recordSnapshot'
    | 'refreshSummaryFromLiveDelta'
    | 'refreshSummaryFromLiveMessage'
    | 'resolvePreviewDelta'
    | 'schedulePrimeFromAll'
    | 'scheduleSseReconnect'
    | 'scheduleWebSocketReconnect'
    | 'snapshotState'
    | 'socket'
    | 'source'
    | 'sseReconnectHandle'
    | 'started'
    | 'streamMetrics'
    | 'submitLatencyMarks'
    | 'theiaByCwd'
    | 'theiaSessionFiles'
    | 'threadStore'
    | 'transport'
    | 'transportWasDisconnected'
    | 'upsert'
    | 'visibilityListenerInstalled'
    | 'wsReconnectAttempt'
    | 'wsReconnectHandle'
    | 'wsSnapshotFallbackHandle';

/**
 * Members of {@link MobileProjectsConversations} that the extracted helper functions
 * access through their `ctx` parameter.
 */
export interface MobileProjectsConversationsContext
    extends Pick<MobileProjectsConversations, MobileProjectsConversationsContextMember> { }
