// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';

export const transcriptActivitySubagentCardClassName = 'theia-mod-subagent-card';

export interface TranscriptSubagentCardModel {
    readonly rootIndex: number;
    readonly childIndexes: readonly number[];
    readonly title: string;
    readonly nestDepth: number;
}

/** For a flat activity list, find subagent roots and their immediate nested children (by parentToolUseId / nestDepth). */
export function resolveTranscriptSubagentCardModels(
    items: readonly TranscriptActivityNavigationItem[],
): readonly TranscriptSubagentCardModel[] {
    const models: TranscriptSubagentCardModel[] = [];
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        if (!item.subagentRoot) {
            continue;
        }
        const rootDepth = item.nestDepth ?? 0;
        const childIndexes: number[] = [];
        for (let childIndex = index + 1; childIndex < items.length; childIndex += 1) {
            const child = items[childIndex]!;
            const childDepth = child.nestDepth ?? 0;
            if (child.subagentRoot && childDepth <= rootDepth) {
                break;
            }
            if (childDepth <= rootDepth) {
                break;
            }
            childIndexes.push(childIndex);
        }
        const title = item.detail?.trim()
            || item.label?.trim()
            || nls.localize('qaap/mobileProjects/transcriptSubagentDefaultTitle', 'Subagent');
        models.push({
            rootIndex: index,
            childIndexes,
            title,
            nestDepth: rootDepth,
        });
    }
    return models;
}
