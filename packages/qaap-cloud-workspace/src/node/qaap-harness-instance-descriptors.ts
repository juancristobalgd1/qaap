// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    QAAP_HARNESS_SETTINGS_PREF,
    resolveQaapHarnessDisplayLabel,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';
import type { QaapAgentDescriptor } from '../common/qaap-agent-task';
import { readQaapOwnerHarnessInstances } from './qaap-harness-launch-overrides';

type PreferenceReader = (key: string) => unknown;

/**
 * The picker catalog with Settings → Harness applied: harnesses switched off are left out, each harness
 * shows the name the user gave it, and every enabled harness instance ("Add harness", `codex#2`) is listed
 * right after its base harness as its own runtime. An instance is listed only when its base harness is
 * installed on this server, even if the base harness itself is switched off.
 */
export function withQaapHarnessInstanceDescriptors(
    descriptors: readonly QaapAgentDescriptor[],
    readPref: PreferenceReader,
    isEnabled: (agentId: string, ownerLogin?: string) => boolean,
    ownerLogin?: string,
): QaapAgentDescriptor[] {
    const settings = readPref(QAAP_HARNESS_SETTINGS_PREF);
    const instances = readQaapOwnerHarnessInstances(readPref);
    const result: QaapAgentDescriptor[] = [];
    for (const descriptor of descriptors) {
        const baseId = descriptor.id.trim().toLowerCase();
        if (isEnabled(descriptor.id, ownerLogin)) {
            result.push({ ...descriptor, label: resolveQaapHarnessDisplayLabel(settings, baseId, descriptor.label) });
        }
        for (const instance of instances) {
            if (instance.baseId === baseId && isEnabled(instance.id, ownerLogin)) {
                result.push({ ...descriptor, id: instance.id, label: resolveQaapHarnessDisplayLabel(settings, instance.id, descriptor.label) });
            }
        }
    }
    return result;
}
