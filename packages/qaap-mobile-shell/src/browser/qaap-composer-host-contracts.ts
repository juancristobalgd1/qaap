// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from './mobile-projects-types';

/*
 * Structural contracts the composer uses to reach Work Hub UIs above it, so the composer layer never imports
 * upward; the concrete Work Hub classes satisfy them structurally.
 */

/** Transcript execution surfaces (preview discovery); implemented by `MobileProjectsTranscriptSurfacesUi`. */
export interface ComposerTranscriptSurfacesApi {
    discoverAndMountTranscriptPreviewIfReady(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void>;
    adoptReadyTranscriptPreview(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, readyUrl: string): MobileProjectEntry;
}

/** Hub project selection; implemented by `MobileProjectsProjectNavigationUi`. */
export interface ComposerProjectNavigationApi {
    resolveSelectedProject(projects?: MobileProjectEntry[]): MobileProjectEntry | undefined;
}
