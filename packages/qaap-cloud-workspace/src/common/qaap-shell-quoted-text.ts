// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Helpers that let flag detection and flag rewriting see only a shell command's own arguments.
 *
 * Agent commands carry the user's prompt as a shell-quoted argument (`shellQuote` in the task runner
 * utils). Any regex that runs over the whole command also runs over that prompt: a prompt mentioning
 * `--yolo` could ungate or mis-gate a run, and a whitespace-collapsing rewrite would silently corrupt it.
 * The scanner here rather than a regex because `shellQuote` escapes `'` as `'\''`, which a naive
 * `'[^']*'` pass would split so prompt text leaks outside.
 */

const PLACEHOLDER_OPEN = '';
const PLACEHOLDER_CLOSE = '';
const PLACEHOLDER_PATTERN = new RegExp(`${PLACEHOLDER_OPEN}(\\d+)${PLACEHOLDER_CLOSE}`, 'g');

/**
 * Half-open `[start, end)` ranges of the quoted (or backslash-escaped) segments of a POSIX shell
 * command. Adjacent segments — `'it'\''s'` — are merged into one range, so they form a single word.
 * An unterminated quote extends to the end of the command.
 */
function quotedShellRanges(command: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    const push = (start: number, end: number): void => {
        const last = ranges[ranges.length - 1];
        if (last && last[1] === start) {
            last[1] = end;
        } else {
            ranges.push([start, end]);
        }
    };
    let index = 0;
    while (index < command.length) {
        const char = command[index];
        if (char === '\\') {
            const end = Math.min(index + 2, command.length);
            push(index, end);
            index = end;
        } else if (char === '\'') {
            const close = command.indexOf('\'', index + 1);
            const end = close < 0 ? command.length : close + 1;
            push(index, end);
            index = end;
        } else if (char === '"') {
            let cursor = index + 1;
            while (cursor < command.length && command[cursor] !== '"') {
                cursor += command[cursor] === '\\' ? 2 : 1;
            }
            const end = Math.min(cursor + 1, command.length);
            push(index, end);
            index = end;
        } else {
            index++;
        }
    }
    return ranges;
}

/**
 * The command with every quoted segment (quotes included) and backslash escape blanked out by spaces.
 * Same length as the input, so match indexes found in the result are valid in the original command.
 * Use it for detection only — never execute or return the masked text.
 */
export function maskShellQuotedText(command: string): string {
    let result = '';
    let cursor = 0;
    for (const [start, end] of quotedShellRanges(command)) {
        result += command.slice(cursor, start) + ' '.repeat(end - start);
        cursor = end;
    }
    return result + command.slice(cursor);
}

/**
 * Apply `rewrite` to the command's unquoted text only. Each quoted word is swapped for an opaque,
 * whitespace-free placeholder before `rewrite` runs and restored byte-for-byte afterwards, so flag
 * stripping and whitespace normalisation can never touch the prompt. A placeholder still behaves
 * like a word, so a flag pattern that consumes a value also consumes a quoted value (`--tools 'A,B'`).
 */
export function rewriteUnquotedShellText(command: string, rewrite: (unquoted: string) => string): string {
    if (command.includes(PLACEHOLDER_OPEN) || command.includes(PLACEHOLDER_CLOSE)) {
        // Cannot tell our placeholders from the command's own text; rewrite unmasked rather than guess.
        return rewrite(command);
    }
    const segments: string[] = [];
    let masked = '';
    let cursor = 0;
    for (const [start, end] of quotedShellRanges(command)) {
        masked += `${command.slice(cursor, start)}${PLACEHOLDER_OPEN}${segments.length}${PLACEHOLDER_CLOSE}`;
        segments.push(command.slice(start, end));
        cursor = end;
    }
    masked += command.slice(cursor);
    return rewrite(masked).replace(PLACEHOLDER_PATTERN, (_match, index: string) => segments[Number(index)] ?? '');
}
