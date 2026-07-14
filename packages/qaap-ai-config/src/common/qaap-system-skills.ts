// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';

/** Backend env var pointing at the bundled Qaap system skill tree (same for every tenant). */
export const QAAP_SYSTEM_SKILLS_DIR_ENV = 'QAAP_SYSTEM_SKILLS_DIR';

/** Default path inside the production Docker image. */
export const DEFAULT_QAAP_SYSTEM_SKILLS_DIR = '/opt/qaap/system-skills';

/** Curated slash skills shipped with Qaap (mirrors `packages/qaap-product/resources/qaap-system-skills`). */
export const QAAP_SYSTEM_SKILL_NAMES = [
    'automate',
    'babysit',
    'canvas',
    'create-hook',
    'create-rule',
    'create-skill',
    'create-subagent',
    'loop',
    'migrate-to-skills',
    'onboard',
    'review',
    'review-bugbot',
    'review-security',
    'sdk',
    'shell',
    'split-to-prs',
] as const;

export type QaapSystemSkillName = typeof QAAP_SYSTEM_SKILL_NAMES[number];

/** Per-user custom skills live under the persisted qaap-auth volume, not in shared home dirs. */
export function qaapPerUserSkillsDirectory(homePath: string, login: string): string {
    return path.join(homePath, '.qaap', 'users', login.trim().toLowerCase(), 'skills');
}
