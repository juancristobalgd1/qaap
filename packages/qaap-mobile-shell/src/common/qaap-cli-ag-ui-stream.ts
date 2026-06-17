// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgUiEvent } from './qaap-ag-ui-transcript-adapter';
import {
    isClaudeCodeAgent,
    isCodexAgent,
    isOpencodeAgent,
    isQaiqAgent,
} from './qaap-agent-task-client';
import { QaapCodexAgUiStreamEmitter } from './qaap-codex-ag-ui-stream';
import { QaapOpencodeAgUiStreamEmitter } from './qaap-opencode-ag-ui-stream';
import { QaapQaiqAgUiStreamEmitter } from './qaap-qaiq-ag-ui-stream';

export interface QaapCliAgUiStreamEmitter {
    push(chunk: string): QaapAgUiEvent[];
}

/** Factory for per-provider CLI stdout → native AG-UI event emitters. */
export function createAgUiCliStreamEmitter(agentId: string | undefined): QaapCliAgUiStreamEmitter | undefined {
    if (isQaiqAgent(agentId) || isClaudeCodeAgent(agentId)) {
        return new QaapQaiqAgUiStreamEmitter();
    }
    if (isCodexAgent(agentId)) {
        return new QaapCodexAgUiStreamEmitter();
    }
    if (isOpencodeAgent(agentId)) {
        return new QaapOpencodeAgUiStreamEmitter();
    }
    return undefined;
}
