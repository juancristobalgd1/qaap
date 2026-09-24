// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `MobileProjectsTranscriptMessagesToolUi` and the extracted free functions in the
// `mobile-projects-transcript-messages-tool-ui-*.ts` cluster. Each extracted function receives the UI typed as
// `MobileProjectsTranscriptMessagesToolUiContext` instead of `any`. As with `MobileProjectsTranscriptSurfacesUiContext`, the
// contract is picked from the class over an explicit member list, so every member keeps the exact
// type the class declares. Members named here are `public` (+ `@internal` where they used to be
// `protected`) on the class. `import type` keeps this free of a runtime import cycle (the class
// imports every extracted module).

import type { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';

/** Members referenced by the extracted `mobile-projects-transcript-messages-tool-ui-*` modules. */
export type MobileProjectsTranscriptMessagesToolUiContextMember =
    | 'appendTranscriptShellSummaryTail'
    | 'appendTranscriptToolPillSummaryTail'
    | 'attachTranscriptFileOpenAction'
    | 'collectTranscriptShellBodyCopyText'
    | 'contentUi'
    | 'copyTranscriptShellText'
    | 'createTranscriptActivityEditExpandRow'
    | 'createTranscriptActivityReadExpandCard'
    | 'createTranscriptActivityTerminalExpandCard'
    | 'createTranscriptAgentAuthLoginCard'
    | 'createTranscriptClampedBlock'
    | 'createTranscriptClampedPre'
    | 'createTranscriptMcpBadge'
    | 'createTranscriptReadLine'
    | 'createTranscriptShellDetails'
    | 'createTranscriptShellWindowHead'
    | 'createTranscriptTextTerminalWindow'
    | 'createTranscriptTodoChecklist'
    | 'createTranscriptTodoChecklistFromItems'
    | 'createTranscriptToolHead'
    | 'createTranscriptToolPillTerminalBody'
    | 'createTranscriptToolResultBody'
    | 'createTranscriptToolResultStreamBody'
    | 'createTranscriptToolSpeculativePlaceholder'
    | 'createTranscriptToolWindow'
    | 'createTranscriptTraceStatusIndicator'
    | 'flashTranscriptShellCopyTooltip'
    | 'handleTranscriptFileOpen'
    | 'handleTranscriptReviewFileOpen'
    | 'host'
    | 'isTranscriptActivityTerminalEntryFailed'
    | 'parseTranscriptShellExitCode'
    | 'renderTranscriptRichContent'
    | 'resolveLobeToolTitleOptions'
    | 'resolveLobeTraceStatus'
    | 'resolveTranscriptActivityTerminalDefaultOpenIndex'
    | 'resolversUi'
    | 'transcriptFileIconClass'
    | 'transcriptShellStateAriaLabel'
    | 'transcriptToolVerb';

/**
 * Members of {@link MobileProjectsTranscriptMessagesToolUi} that the extracted helper functions access through their `ctx`
 * parameter.
 */
export interface MobileProjectsTranscriptMessagesToolUiContext
    extends Pick<MobileProjectsTranscriptMessagesToolUi, MobileProjectsTranscriptMessagesToolUiContextMember> { }
