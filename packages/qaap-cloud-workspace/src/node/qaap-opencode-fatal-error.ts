// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isAgentQuotaOrRateLimitText } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';

/** Pending partial stderr line kept between chunks; longer than this is not a log line we need. */
const MAX_PENDING_STDERR_LENGTH = 64 * 1024;

const OPENCODE_ERROR_LEVEL = /\blevel=ERROR\b|^ERROR\b/;
const OPENCODE_STREAM_ERROR_MESSAGE = /\bmessage="stream error"/;
/** The main agent turn; the `small=true` title request is not a reason to stop the task. */
const OPENCODE_MAIN_TURN = /\bsmall=false\b/;
const OPENCODE_ERROR_FIELD = /\berror\.error="((?:[^"\\]|\\.)*)"/;

/**
 * Returns the provider error when an OpenCode `--print-logs` line reports that the main turn's
 * stream failed on a quota, usage limit or rate limit. OpenCode keeps the CLI alive after such an
 * error and prints nothing on stdout in `--format json` mode, so the runner must stop the run.
 */
export function detectOpencodeFatalStreamError(line: string): string | undefined {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('{')) {
        return undefined;
    }
    if (!OPENCODE_ERROR_LEVEL.test(trimmed)
        || !OPENCODE_STREAM_ERROR_MESSAGE.test(trimmed)
        || !OPENCODE_MAIN_TURN.test(trimmed)) {
        return undefined;
    }
    const match = OPENCODE_ERROR_FIELD.exec(trimmed);
    if (!match) {
        return undefined;
    }
    const error = match[1].replace(/\\(.)/g, '$1').trim();
    return error && isAgentQuotaOrRateLimitText(error) ? error : undefined;
}

/** Feeds OpenCode stderr chunks and reports the first fatal stream error, once. */
export interface OpencodeFatalStderrWatcher {
    /** Returns the fatal error text the first time a complete stderr line carries one. */
    push(chunk: string): string | undefined;
}

export function createOpencodeFatalStderrWatcher(): OpencodeFatalStderrWatcher {
    let pending = '';
    let reported = false;
    return {
        push(chunk: string): string | undefined {
            if (reported) {
                return undefined;
            }
            const lines = `${pending}${chunk}`.split('\n');
            pending = lines.pop() ?? '';
            if (pending.length > MAX_PENDING_STDERR_LENGTH) {
                pending = '';
            }
            for (const line of lines) {
                const error = detectOpencodeFatalStreamError(line);
                if (error) {
                    reported = true;
                    return error;
                }
            }
            return undefined;
        },
    };
}
