// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_QAAP_SYSTEM_SKILLS_DIR, QAAP_SYSTEM_SKILLS_DIR_ENV } from '../common/qaap-system-skills';

/** Resolve the bundled system-skills directory when the env var is unset (local dev). */
export function resolveBundledQaapSystemSkillsDir(): string | undefined {
    const fromRepo = path.resolve(__dirname, '../../../qaap-product/resources/qaap-system-skills');
    if (fs.existsSync(fromRepo)) {
        return fromRepo;
    }
    if (fs.existsSync(DEFAULT_QAAP_SYSTEM_SKILLS_DIR)) {
        return DEFAULT_QAAP_SYSTEM_SKILLS_DIR;
    }
    return undefined;
}

/** Ensures `process.env.QAAP_SYSTEM_SKILLS_DIR` is set before the frontend scans skills. */
export function ensureQaapSystemSkillsDirEnv(): void {
    if (process.env[QAAP_SYSTEM_SKILLS_DIR_ENV]?.trim()) {
        return;
    }
    const resolved = resolveBundledQaapSystemSkillsDir();
    if (resolved) {
        process.env[QAAP_SYSTEM_SKILLS_DIR_ENV] = resolved;
    }
}
