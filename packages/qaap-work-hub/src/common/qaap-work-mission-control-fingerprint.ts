// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type {
    MissionControlLaneFilter,
    MissionControlSurfaceFilter,
} from '../browser/mobile-work-mission-control';

export const QAAP_MC_STRUCTURE_FP_ATTR = 'data-qaap-mc-structure-fp';
export const QAAP_MC_ROW_KEY_ATTR = 'data-qaap-mc-row-key';
export const QAAP_MC_ROW_FP_ATTR = 'data-qaap-mc-row-fp';

export interface MissionControlRowFingerprintInput {
    readonly key: string;
    readonly lane: string;
    readonly title: string;
    readonly preview?: string;
    readonly failureKind?: string;
    readonly progressCurrent?: number;
    readonly progressTotal?: number;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
    readonly updatedAt: number;
}

export interface MissionControlStructureFingerprintInput {
    readonly expanded: boolean;
    readonly laneFilter: MissionControlLaneFilter;
    readonly surfaceFilter: MissionControlSurfaceFilter;
    readonly query: string;
    readonly showOverview: boolean;
    readonly rowKeys: readonly string[];
}

export function buildMissionControlRowFingerprint(input: MissionControlRowFingerprintInput): string {
    return [
        input.key,
        input.lane,
        input.title,
        input.preview ?? '',
        input.failureKind ?? '',
        input.progressCurrent ?? '',
        input.progressTotal ?? '',
        input.linesAdded ?? '',
        input.linesRemoved ?? '',
        input.updatedAt,
    ].join(':');
}

export function buildMissionControlStructureFingerprint(
    input: MissionControlStructureFingerprintInput,
): string {
    const parts: string[] = [
        `e:${input.expanded ? 1 : 0}`,
        `l:${input.laneFilter}`,
        `s:${input.surfaceFilter}`,
        `q:${input.query.trim().toLowerCase()}`,
        `o:${input.showOverview ? 1 : 0}`,
    ];
    for (const key of input.rowKeys) {
        parts.push(`r:${key}`);
    }
    return parts.join('|');
}
