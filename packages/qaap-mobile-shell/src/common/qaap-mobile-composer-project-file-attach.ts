// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { AIVariable, AIVariableResolutionRequest, AIVariableService } from '@theia/ai-core';

export const COMPOSER_PROJECT_FILE_QUERY_CONTEXT = { type: 'context-variable-picker' } as const;

export async function resolveComposerProjectFileAttachment(
    variableService: AIVariableService,
    fileVariable: AIVariable,
): Promise<AIVariableResolutionRequest | undefined> {
    const argumentPicker = await variableService.getArgumentPicker(
        fileVariable.name,
        COMPOSER_PROJECT_FILE_QUERY_CONTEXT,
    );
    if (!argumentPicker) {
        return undefined;
    }
    const arg = await argumentPicker(COMPOSER_PROJECT_FILE_QUERY_CONTEXT);
    if (!arg) {
        return undefined;
    }
    return { variable: fileVariable, arg };
}
