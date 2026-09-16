// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { EnvVariable } from '@theia/core/lib/common/env-variables';

/**
 * Backend environment variables are not a tenant configuration channel.
 * Keep this deny-list conservative: a newly added secret-like variable must not
 * become readable by a browser/plugin merely because its name was not allowlisted.
 */
const SENSITIVE_ENV_KEY = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|cookie|docker[_-]?host|password|private[_-]?key|secret|session|token|vapid)/i;

export function isQaapSensitiveEnvKey(key: string): boolean {
    return SENSITIVE_ENV_KEY.test(key);
}

export function filterQaapFrontendEnvironment(variables: readonly EnvVariable[]): EnvVariable[] {
    return variables.filter(variable => !isQaapSensitiveEnvKey(variable.name));
}
