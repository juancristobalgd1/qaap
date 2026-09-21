// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from './mobile-projects-types';

function isUsableAgentLoginCwd(cwd: string | undefined): cwd is string {
    return !!cwd?.trim() && !isQaapWorkspaceContainerPath(cwd);
}

/**
 * Resolve the real repository path used by the hidden login terminal.
 *
 * Hosted Work Hub conversations can carry the shared workspace/container path even when the
 * selected GitHub project has a tenant-owned clone. That path is fine for rendering the task,
 * but it must never be passed to a terminal: it would either be rejected by the tenant guard or
 * start the CLI outside the selected repository. Prepare the GitHub project before consulting
 * the conversation fallback so the picker and the transcript use the same tenant path.
 */
export async function resolveAgentLoginCwd(
    ctx: any,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
): Promise<string | undefined> {
    const cachedProjectCwd = ctx.projectsService.getProjectCwd(project)
        ?? ctx.preparedCwdByProjectId?.get?.(project.id);
    if (isUsableAgentLoginCwd(cachedProjectCwd)) {
        return cachedProjectCwd;
    }

    if (project.github && ctx.projectsService.prepareProjectCwd) {
        const preparedCwd = await ctx.projectsService.prepareProjectCwd(project);
        if (isUsableAgentLoginCwd(preparedCwd)) {
            ctx.preparedCwdByProjectId?.set?.(project.id, preparedCwd);
            return preparedCwd;
        }
    }

    const transcriptCwd = ctx.transcriptSurfacesUi?.resolveTranscriptProjectCwd?.(project, summary);
    if (isUsableAgentLoginCwd(transcriptCwd)) {
        return transcriptCwd;
    }

    return isUsableAgentLoginCwd(summary.cwd) ? summary.cwd : undefined;
}
