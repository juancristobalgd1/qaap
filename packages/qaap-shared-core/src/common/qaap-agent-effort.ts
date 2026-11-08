// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { isOpenCodeFreeModelId } from './qaap-opencode-model-catalog';

/** Reasoning effort a coding harness can be asked to spend on a turn. */
export type QaapAgentEffortLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Levels a harness/model accepts, and the level used when the user has not chosen one. */
export interface QaapAgentEffortSupport {
    readonly levels: readonly QaapAgentEffortLevel[];
    readonly defaultLevel: QaapAgentEffortLevel;
}

const CLAUDE_EFFORT_SUPPORT: QaapAgentEffortSupport = {
    levels: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultLevel: 'high',
};
const CODEX_EFFORT_SUPPORT: QaapAgentEffortSupport = {
    levels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaultLevel: 'medium',
};
const OPENCODE_EFFORT_SUPPORT: QaapAgentEffortSupport = {
    levels: ['minimal', 'low', 'medium', 'high', 'max'],
    defaultLevel: 'medium',
};
const PI_EFFORT_SUPPORT: QaapAgentEffortSupport = {
    levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultLevel: 'medium',
};

export namespace QaapAgentEffort {

    /**
     * Effort levels for a harness and model. `undefined` means the harness or model takes no
     * effort setting (the UI shows "No effort levels").
     */
    export function support(agentId: string, modelId: string | undefined): QaapAgentEffortSupport | undefined {
        switch (agentId.trim().toLowerCase()) {
            case 'claude':
                return CLAUDE_EFFORT_SUPPORT;
            case 'codex':
                return CODEX_EFFORT_SUPPORT;
            case 'opencode':
                return modelId && isOpenCodeFreeModelId(modelId.toLowerCase()) ? undefined : OPENCODE_EFFORT_SUPPORT;
            case 'pi':
                return PI_EFFORT_SUPPORT;
            default:
                return undefined;
        }
    }

    /** User-facing name of an effort level. */
    export function label(level: QaapAgentEffortLevel): string {
        switch (level) {
            case 'off':
                return nls.localize('qaap/composer/picker/effortOff', 'Off');
            case 'minimal':
                return nls.localize('qaap/composer/picker/effortMinimal', 'Minimal');
            case 'low':
                return nls.localize('qaap/composer/picker/effortLow', 'Low');
            case 'medium':
                return nls.localize('qaap/composer/picker/effortMedium', 'Medium');
            case 'high':
                return nls.localize('qaap/composer/picker/effortHigh', 'High');
            case 'xhigh':
                return nls.localize('qaap/composer/picker/effortXHigh', 'Extra high');
            case 'max':
                return nls.localize('qaap/composer/picker/effortMax', 'Max');
        }
    }

    /**
     * The level to send for a harness and model, or `undefined` when it is missing or not
     * supported by that harness/model. Unsupported values are dropped, never rejected.
     */
    export function normalize(agentId: string, modelId: string | undefined, level: string | undefined): QaapAgentEffortLevel | undefined {
        if (!level) {
            return undefined;
        }
        const supported = support(agentId, modelId);
        const match = supported?.levels.find(candidate => candidate === level.trim().toLowerCase());
        return match;
    }
}
