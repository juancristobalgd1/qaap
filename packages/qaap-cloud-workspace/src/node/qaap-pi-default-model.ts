// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolvePiDefaultModelFlag } from '@theia/qaap-shared-core/lib/common/qaap-pi-default-model';

function readOptionalFile(file: string): string | undefined {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return undefined;
    }
}

/**
 * The `--model` flag for a Pi turn without a chosen model, read from the Pi agent directory the Pi child
 * will use (`PI_CODING_AGENT_DIR`, else `$HOME/.pi/agent`). Empty when the owner pinned a default.
 */
export function readPiDefaultModelFlag(env: NodeJS.ProcessEnv = process.env): string {
    const agentDir = env.PI_CODING_AGENT_DIR?.trim() || path.join(env.HOME?.trim() || os.homedir(), '.pi', 'agent');
    return resolvePiDefaultModelFlag({
        settingsJson: readOptionalFile(path.join(agentDir, 'settings.json')),
        authJson: readOptionalFile(path.join(agentDir, 'auth.json')),
        openRouterKeyInEnv: !!env.OPENROUTER_API_KEY?.trim(),
    });
}
