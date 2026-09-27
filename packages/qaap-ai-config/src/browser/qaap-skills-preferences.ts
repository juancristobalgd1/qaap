// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';
import { injectable } from '@theia/core/shared/inversify';

/** Skill names excluded from the Work Hub composer `/` menu and slash expansion. */
export const QAAP_DISABLED_SKILLS_PREF = 'ai-features.skills.disabledSkills';

export const qaapSkillsPreferenceSchema: PreferenceSchema = {
    properties: {
        [QAAP_DISABLED_SKILLS_PREF]: {
            type: 'array',
            items: { type: 'string' },
            default: [],
            description: nls.localize(
                'qaap/preferences/disabledSkills',
                'Skill names that are disabled in the Work Hub composer slash menu.',
            ),
        },
    },
};

@injectable()
export class QaapSkillsPreferenceContribution implements PreferenceContribution {
    readonly schema = qaapSkillsPreferenceSchema;
}

export function readDisabledSkillNames(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0);
}

export function isQaapSkillEnabled(skillName: string, disabledNames: readonly string[]): boolean {
    const needle = skillName.trim().toLowerCase();
    return !disabledNames.some(name => name.trim().toLowerCase() === needle);
}

export function withQaapSkillEnabled(
    disabledNames: readonly string[],
    skillName: string,
    enabled: boolean,
): string[] {
    const needle = skillName.trim().toLowerCase();
    const without = disabledNames.filter(name => name.trim().toLowerCase() !== needle);
    if (enabled) {
        return without;
    }
    return [...without, skillName.trim()].sort((a, b) => a.localeCompare(b));
}
