// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { WorkHubTeamMember } from './qaap-work-hub-team';

export const QAAP_TEAM_SECTION_FP_ATTR = 'data-qaap-team-section-fp';
export const QAAP_TEAM_MEMBER_ID_ATTR = 'data-qaap-team-member-id';
export const QAAP_TEAM_ROW_FP_ATTR = 'data-qaap-team-row-fp';

export function buildWorkHubTeamRowFingerprint(member: WorkHubTeamMember): string {
    return [
        member.id,
        member.state,
        member.title,
        member.updatedAt,
        member.progressCurrent ?? '',
        member.progressTotal ?? '',
        member.activityLabel ?? '',
        member.command ?? '',
        member.linesAdded ?? '',
        member.linesRemoved ?? '',
        member.childCount,
    ].join(':');
}

export function buildWorkHubTeamSectionFingerprint(
    members: readonly WorkHubTeamMember[],
    approvalsCount: number,
): string {
    const parts: string[] = [`a:${approvalsCount}`];
    const sorted = [...members].sort((left, right) => left.id.localeCompare(right.id));
    for (const member of sorted) {
        parts.push(`m:${member.id}:${member.parentId ?? ''}`);
    }
    return parts.join('|');
}
