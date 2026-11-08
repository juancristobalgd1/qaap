// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task';
import { isPiAgent } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { listNativeAgentModels } from './qaap-agent-native-models';

/**
 * The models the owner's Pi CLI reports (`pi --list-models` under the owner's sign-in), as fallback
 * candidates. Pi lists only the providers the owner signed in to, so its curated cold-start list may name
 * models the owner cannot run. Empty for other agents and while the owner's listing is not cached yet:
 * the chain then uses the curated list.
 */
export function discoveredFallbackModels(agentId: string, ownerLogin: string | undefined): readonly QaapCreateAgentTaskQaiqModel[] {
    if (!isPiAgent(agentId)) {
        return [];
    }
    return listNativeAgentModels(agentId, ownerLogin).map(option => ({
        provider: option.provider,
        vendor: option.vendor,
        modelId: option.modelId,
    }));
}
