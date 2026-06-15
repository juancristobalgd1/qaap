// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { tryParseJsonRecord } from './qaap-transcript-tool-ui-payloads';

export interface AskUserQuestionSelection {
    readonly questionId: string;
    readonly questionText: string;
    readonly optionId: string;
    readonly optionLabel: string;
}

/** QAIQ / Claude `AskUserQuestion` tool name variants. */
export function isAskUserQuestionToolName(toolName: string | undefined): boolean {
    if (!toolName?.trim()) {
        return false;
    }
    return toolName.replace(/[^a-z0-9]/gi, '').toLowerCase().includes('askuserquestion');
}

/** Merge a user pick into the tool args QAIQ expects on `can_use_tool` approval. */
export function buildAskUserQuestionUpdatedInput(
    argsJson: string,
    selection: AskUserQuestionSelection,
): Record<string, unknown> | undefined {
    const record = tryParseJsonRecord(argsJson);
    if (!record) {
        return undefined;
    }
    const existingAnswers = record.answers;
    const answers: Record<string, string> = {};
    if (existingAnswers && typeof existingAnswers === 'object' && !Array.isArray(existingAnswers)) {
        for (const [key, value] of Object.entries(existingAnswers)) {
            if (typeof value === 'string') {
                answers[key] = value;
            }
        }
    }
    answers[selection.questionText] = selection.optionLabel;
    return {
        ...record,
        answers,
    };
}
