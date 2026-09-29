// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
//
// Portions adapted from ZCode (Apache-2.0): the read-only command/flag policy
// (bash-readonly-policy*.ts, bash-command-registry.ts) informed the allowlists below.
// The tokenizer is an independent, deliberately conservative re-implementation.
// *****************************************************************************

/**
 * User preference (per tenant, `ai-features.*` so it syncs with the per-user AI settings file):
 * when on, agent shell tool calls whose command is provably read-only are approved without a prompt.
 */
export const QAAP_AUTO_APPROVE_READONLY_SHELL_PREF = 'ai-features.agentApprovals.autoApproveReadOnlyShell';

/**
 * Default for {@link QAAP_AUTO_APPROVE_READONLY_SHELL_PREF}. Off: the shortcut skips prompts the user
 * chose by picking request-approval, so it must be an explicit opt-in.
 */
export const QAAP_AUTO_APPROVE_READONLY_SHELL_DEFAULT = false;

/** Resolve the preference value; anything that is not an explicit boolean falls back to the default. */
export function resolveAutoApproveReadOnlyShellPreference(value: unknown): boolean {
    return typeof value === 'boolean' ? value : QAAP_AUTO_APPROVE_READONLY_SHELL_DEFAULT;
}

/** Outcome of {@link QaapBashReadOnlyClassifier.classify}. `reason` is a short diagnostic (not user-facing). */
export interface QaapBashReadOnlyClassification {
    readonly readOnly: boolean;
    readonly reason: string;
    /** Command names of every simple command, in order (only set when `readOnly`). */
    readonly commands?: readonly string[];
    /**
     * Every non-flag argument (including input redirection targets), relative to the task cwd with `cd`
     * applied, or absolute as written. The check is lexical, so callers with filesystem access must still
     * verify these do not reach outside the cwd through symlinks (only set when `readOnly`).
     */
    readonly paths?: readonly string[];
}

/** Options for {@link QaapBashReadOnlyClassifier.classify}. */
export interface QaapBashReadOnlyClassifyOptions {
    /**
     * Working directory the command runs in (POSIX or Windows absolute path). Absolute path arguments
     * are read-only only when they stay inside it; without a cwd every absolute path is rejected.
     */
    readonly cwd?: string;
}

/** One word of a simple command after quote removal. */
interface QaapShellWord {
    readonly value: string;
    /** Some part of the word was quoted or escaped (so it is never a keyword/assignment/glob). */
    readonly quoted: boolean;
    /** Contains an unquoted glob character (`*`, `?`, `[`). */
    readonly glob: boolean;
}

type QaapShellToken =
    | { readonly kind: 'word'; readonly word: QaapShellWord }
    | { readonly kind: 'op'; readonly op: ';' | '&&' | '||' | '|' };

class QaapShellRejection extends Error { }

const MAX_COMMAND_LENGTH = 4000;

/** Commands that only read state and accept any arguments (no flag can make them write or execute). */
const ANY_ARGS_COMMANDS = new Set([
    'ls', 'cat', 'head', 'tail', 'wc', 'echo', 'basename', 'dirname', 'realpath', 'readlink', 'stat',
    'du', 'df', 'cut', 'tr', 'nl', 'rev', 'tac', 'cmp', 'diff', 'comm', 'column', 'strings', 'od',
    'hexdump', 'which', 'type', 'id', 'uname', 'grep', 'egrep', 'fgrep', 'md5sum', 'sha1sum',
    'sha256sum', 'sha512sum', 'cksum', 'seq', 'expr', 'test', 'paste', 'fold', 'fmt', 'expand',
    'unexpand', 'jq', 'cd', 'groups', 'locale', 'numfmt',
]);

/** Commands that are read-only only when invoked without arguments. */
const NO_ARGS_COMMANDS = new Set(['pwd', 'whoami', 'true', 'false', 'nproc', 'uptime', 'free', 'tty', 'hostname']);

/** `date` arguments that only format output (`date -s …` would set the clock). */
const DATE_READ_ARG_RE = /^(?:\+.*|-u|--utc|--universal|-R|--rfc-email|-I\w*|--iso-8601(?:=\w+)?)$/;

/** Flags of `git branch` / `git tag` listings whose next argument is a commit, not a new ref name. */
const GIT_LISTING_VALUE_FLAGS = new Set(['--contains', '--no-contains', '--merged', '--no-merged', '--points-at']);

/** find expressions that execute programs, delete, or write files. */
const FIND_FORBIDDEN_PRIMARIES = new Set([
    '-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls',
]);

/** git subcommands that never mutate the repository (argument checks below narrow the rest). */
const GIT_READONLY_SUBCOMMANDS = new Set([
    'status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file', 'blame', 'shortlog',
    'describe', 'grep', 'merge-base', 'name-rev', 'count-objects', 'for-each-ref', 'show-ref', 'rev-list',
    'diff-tree', 'diff-files', 'diff-index', 'version', 'whatchanged', 'annotate', 'show-branch', 'var',
    'check-ignore', 'check-attr', 'cherry',
]);

/**
 * git long flags that write files or run external programs even on read subcommands. Matched by
 * PREFIX (see {@link isLongOptionPrefix}): parse-options accepts unambiguous abbreviations.
 */
const GIT_FORBIDDEN_LONG_OPTIONS = ['output', 'output-directory', 'ext-diff', 'exec', 'upload-pack', 'receive-pack', 'open-files-in-pager'];

/** git short flags that run a program (`grep -O<pager>`); matched anywhere in a bundle such as `-iO`. */
const GIT_FORBIDDEN_SHORT_FLAG_RE = /^-[^-]*O/;

/** git flags that make read commands read files outside the index (untracked / ignored content). */
const GIT_UNTRACKED_READ_LONG_OPTIONS = ['untracked', 'no-index', 'no-exclude-standard'];

/** grep/egrep/fgrep flags that recurse into directories (short bundles like `-rn` included). */
const GREP_RECURSIVE_ARG_RE = /^-[^-]*[rR]|^--(?:recursive|dereference-recursive)$|^--directories=recurse$|^-d$/;

/** rg flags that search hidden / ignored files, follow symlinks, or run programs. */
const RG_FORBIDDEN_ARG_RE = /^--(?:pre|pre-glob|hostname-bin|hidden|no-ignore[\w-]*|unrestricted|follow)(?:=|$)|^-[^-]*[u.L]/;

/** fd flags that execute programs (`-x`/`-X`, also inside bundles such as `-Hx`). */
const FD_FORBIDDEN_ARG_RE = /^-[^-]*[xX]|^--exec/;

/** `git branch` flags that only list. */
// eslint-disable-next-line max-len
const GIT_BRANCH_LIST_FLAGS_RE = /^(?:-l|--list|-a|--all|-r|--remotes|-v|-vv|--verbose|--show-current|--no-color|--color(?:=.*)?|--column(?:=.*)?|--no-column|--sort=.+|--format=.+|--contains|--no-contains|--merged|--no-merged|--points-at|--ignore-case|--abbrev=\d+|--no-abbrev)$/;
/** `git tag` flags that only list. */
// eslint-disable-next-line max-len
const GIT_TAG_LIST_FLAGS_RE = /^(?:-l|--list|-n\d*|--sort=.+|--format=.+|--contains|--no-contains|--merged|--no-merged|--points-at|--column(?:=.*)?|--no-column|--ignore-case|--color(?:=.*)?)$/;
/** `git config` read-only modes. */
// eslint-disable-next-line max-len
const GIT_CONFIG_READ_FLAGS = new Set(['--get', '--get-all', '--get-regexp', '--list', '-l', '--get-urlmatch', '--show-origin', '--show-scope', '--name-only', '--null', '-z', '--global', '--system', '--local', '--includes', '--no-includes']);

/** Path components that name credentials or secrets (`.env*`, SSH keys, `*.pem`, `*.key`, `.npmrc`, …). */
const SENSITIVE_PATH_COMPONENT_RE = /^(?:\.env(?:$|[.*?[])|id_(?:rsa|dsa|ecdsa|ed25519)|\.npmrc$|\.netrc$|\.git-credentials$|\.aws$|\.ssh$|credentials)|\.(?:pem|key)$/i;

const WINDOWS_DRIVE_RE = /^([A-Za-z]):\//;

/**
 * Representative names the sensitive-path policy protects. A glob segment that could expand to any of
 * them (`.en?`, `id_r*`, `*`) is treated as naming a secret, since the literal check cannot see it.
 */
const SENSITIVE_SAMPLE_NAMES = [
    '.env', '.env.local', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', '.npmrc', '.netrc', '.git-credentials',
    '.aws', '.ssh', 'credentials', 'credentials.json', 'server.pem', 'server.key',
];

/** `--name[=value]` that is a (possibly abbreviated) spelling of one of `longOptions`. */
function isLongOptionPrefix(arg: string, longOptions: readonly string[]): boolean {
    if (!arg.startsWith('--') || arg.length < 3) {
        return false;
    }
    const name = arg.slice(2).split('=')[0];
    return longOptions.some(option => option.startsWith(name));
}

/** Converts one unquoted glob path segment (`*`, `?`, `[...]`) to an anchored RegExp. */
function globSegmentToRegExp(segment: string): RegExp {
    let source = '';
    for (let i = 0; i < segment.length; i++) {
        const ch = segment[i];
        if (ch === '*') {
            source += '.*';
        } else if (ch === '?') {
            source += '.';
        } else if (ch === '[') {
            const end = segment.indexOf(']', i + 2);
            if (end < 0) {
                source += '\\[';
            } else {
                const body = segment.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\');
                source += `[${body}]`;
                i = end;
            }
        } else {
            source += ch.replace(/[.+^${}()|\\]/g, '\\$&');
        }
    }
    return new RegExp(`^${source}$`, 'i');
}

/** A `sed` script that only prints line ranges, e.g. `10,20p`, `$p`, `5p`. */
const SED_PRINT_SCRIPT_RE = /^(?:\d+|\$)(?:,(?:\d+|\$))?p$/;

/**
 * Conservative classifier for agent shell commands: `readOnly: true` only when every simple command
 * in the (optionally piped / chained) command line is on a read-only allowlist with safe arguments.
 * Anything the tokenizer cannot prove harmless — expansions (`$…`, backticks), subshells, writes via
 * redirection, env-var prefixes, background jobs, heredocs, unknown commands — is NOT read-only.
 *
 * It is not a sandbox: a read-only verdict means "does not modify files or run arbitrary programs by
 * itself", which is the bar for skipping an approval prompt. Destructive-command guards still win.
 */
export class QaapBashReadOnlyClassifier {

    classify(command: string | undefined, options: QaapBashReadOnlyClassifyOptions = {}): QaapBashReadOnlyClassification {
        const text = (command ?? '').replace(/\r/g, '');
        if (!text.trim()) {
            return { readOnly: false, reason: 'empty command' };
        }
        if (text.length > MAX_COMMAND_LENGTH) {
            return { readOnly: false, reason: 'command too long to classify' };
        }
        let segments: QaapShellWord[][];
        const paths: string[] = [];
        try {
            const inputTargets: string[] = [];
            segments = this.splitSimpleCommands(this.tokenize(text, inputTargets));
            const inputReason = inputTargets.map(target => this.checkPathWord(target, [], options.cwd)).find(Boolean);
            if (inputReason) {
                return { readOnly: false, reason: inputReason };
            }
            paths.push(...inputTargets.map(target => this.describePath(target, [])));
        } catch (error) {
            return { readOnly: false, reason: error instanceof QaapShellRejection ? error.message : 'unparseable command' };
        }
        // Relative location (path segments below cwd) tracked through `cd` so `cd a && cat ../../x` is caught.
        let location: string[] = [];
        for (const words of segments) {
            const reason = this.checkSimpleCommand(words) ?? this.checkPathArguments(words, location, options.cwd, paths);
            if (reason) {
                return { readOnly: false, reason };
            }
            if (words[0].value === 'cd') {
                const next = words.length === 2 ? this.resolveRelative(words[1].value, location) : undefined;
                if (!next) {
                    return { readOnly: false, reason: 'cd outside the working directory' };
                }
                location = next;
            }
        }
        const commands = segments.map(words => words[0].value);
        return { readOnly: true, reason: `read-only: ${commands.join(', ')}`, commands, paths };
    }

    /** Lexes the command into words and control operators, rejecting every construct we do not model. */
    protected tokenize(text: string, inputTargets: string[] = []): QaapShellToken[] {
        const tokens: QaapShellToken[] = [];
        let i = 0;
        let value = '';
        let quoted = false;
        let glob = false;
        let inWord = false;
        const endWord = (): void => {
            if (inWord) {
                tokens.push({ kind: 'word', word: { value, quoted, glob } });
            }
            value = '';
            quoted = false;
            glob = false;
            inWord = false;
        };
        const reject = (reason: string): never => {
            throw new QaapShellRejection(reason);
        };
        while (i < text.length) {
            const ch = text[i];
            if (ch === ' ' || ch === '\t') {
                endWord();
                i++;
                continue;
            }
            if (ch === '\n' || ch === ';') {
                endWord();
                tokens.push({ kind: 'op', op: ';' });
                i++;
                continue;
            }
            if (ch === '#' && !inWord) {
                while (i < text.length && text[i] !== '\n') {
                    i++;
                }
                continue;
            }
            if (ch === '&') {
                if (text[i + 1] === '&') {
                    endWord();
                    tokens.push({ kind: 'op', op: '&&' });
                    i += 2;
                    continue;
                }
                if (text[i + 1] === '>') {
                    endWord();
                    i = this.consumeRedirection(text, i + 2, '>', inputTargets);
                    continue;
                }
                reject('background job (&)');
            }
            if (ch === '|') {
                endWord();
                if (text[i + 1] === '|') {
                    tokens.push({ kind: 'op', op: '||' });
                    i += 2;
                    continue;
                }
                if (text[i + 1] === '&') {
                    reject('|& pipe');
                }
                tokens.push({ kind: 'op', op: '|' });
                i++;
                continue;
            }
            if (ch === '>' || ch === '<') {
                // `2>` / `1>`: an unquoted all-digit word right before the operator is an fd number.
                if (inWord && !(!quoted && /^\d+$/.test(value))) {
                    reject('redirection glued to a word');
                }
                value = '';
                quoted = false;
                glob = false;
                inWord = false;
                i = this.consumeRedirection(text, i + 1, ch, inputTargets);
                continue;
            }
            if (ch === '(' || ch === ')') {
                reject('subshell or process substitution');
            }
            if (ch === '`') {
                reject('command substitution (backticks)');
            }
            if (ch === '$') {
                reject('shell expansion ($)');
            }
            if (ch === '\\') {
                if (text[i + 1] === '\n') {
                    i += 2;
                    continue;
                }
                if (i + 1 >= text.length) {
                    reject('dangling escape');
                }
                value += text[i + 1];
                quoted = true;
                inWord = true;
                i += 2;
                continue;
            }
            if (ch === '\'') {
                const end = text.indexOf('\'', i + 1);
                if (end < 0) {
                    reject('unterminated single quote');
                }
                value += text.slice(i + 1, end);
                quoted = true;
                inWord = true;
                i = end + 1;
                continue;
            }
            if (ch === '"') {
                i++;
                let closed = false;
                while (i < text.length) {
                    const inner = text[i];
                    if (inner === '"') {
                        closed = true;
                        i++;
                        break;
                    }
                    if (inner === '$' || inner === '`') {
                        reject('expansion inside double quotes');
                    }
                    if (inner === '\\' && i + 1 < text.length && '"\\$`\n'.includes(text[i + 1])) {
                        if (text[i + 1] !== '\n') {
                            value += text[i + 1];
                        }
                        i += 2;
                        continue;
                    }
                    value += inner;
                    i++;
                }
                if (!closed) {
                    reject('unterminated double quote');
                }
                quoted = true;
                inWord = true;
                continue;
            }
            if (ch === '*' || ch === '?' || ch === '[') {
                glob = true;
            }
            value += ch;
            inWord = true;
            i++;
        }
        endWord();
        return tokens;
    }

    /**
     * Validates one redirection starting after its first operator char; returns the index after it.
     * Output may only go to `/dev/null` or duplicate an fd; input redirection from a file is a read.
     */
    protected consumeRedirection(text: string, start: number, direction: '>' | '<', inputTargets: string[]): number {
        let i = start;
        if (direction === '<') {
            if (text[i] === '<' || text[i] === '>' || text[i] === '&' || text[i] === '(') {
                throw new QaapShellRejection('heredoc or unsupported input redirection');
            }
        } else {
            if (text[i] === '(') {
                throw new QaapShellRejection('process substitution');
            }
            if (text[i] === '&') {
                const fd = /^(?:\d+|-)(?=[\s;|&]|$)/.exec(text.slice(i + 1));
                if (!fd) {
                    throw new QaapShellRejection('unsupported fd duplication');
                }
                return i + 1 + fd[0].length;
            }
            if (text[i] === '>' || text[i] === '|') {
                i++;
            }
        }
        while (text[i] === ' ' || text[i] === '\t') {
            i++;
        }
        const target = /^[^\s;|&<>()`$'"\\]+/.exec(text.slice(i));
        if (!target) {
            throw new QaapShellRejection('unsupported redirection target');
        }
        if (direction === '>' && target[0] !== '/dev/null') {
            throw new QaapShellRejection('output redirection to a file');
        }
        if (direction === '<') {
            inputTargets.push(target[0]);
        }
        return i + target[0].length;
    }

    /** Splits tokens at control operators; every operand must be a non-empty simple command. */
    protected splitSimpleCommands(tokens: QaapShellToken[]): QaapShellWord[][] {
        const segments: QaapShellWord[][] = [];
        let current: QaapShellWord[] = [];
        let pendingOperator: string | undefined;
        for (const token of tokens) {
            if (token.kind === 'word') {
                current.push(token.word);
                pendingOperator = undefined;
                continue;
            }
            if (current.length === 0) {
                // Tolerate blank lines / repeated `;`, but not `| cmd`, `&& cmd`, `a | | b`.
                if (token.op === ';' && (pendingOperator === undefined || pendingOperator === ';')) {
                    continue;
                }
                throw new QaapShellRejection(`missing command around ${token.op}`);
            }
            segments.push(current);
            current = [];
            pendingOperator = token.op;
        }
        if (current.length) {
            segments.push(current);
        } else if (pendingOperator !== undefined && pendingOperator !== ';') {
            throw new QaapShellRejection(`missing command after ${pendingOperator}`);
        }
        if (!segments.length) {
            throw new QaapShellRejection('empty command');
        }
        return segments;
    }

    /** Returns a rejection reason, or `undefined` when the simple command is read-only. */
    protected checkSimpleCommand(words: QaapShellWord[]): string | undefined {
        const [head, ...args] = words;
        const name = head.value;
        if (!head.quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(name)) {
            return 'environment variable assignment';
        }
        if (!name || name.includes('/') || head.glob) {
            return `unsupported command name: ${name}`;
        }
        if (NO_ARGS_COMMANDS.has(name)) {
            return args.length === 0 ? undefined : `${name} with arguments`;
        }
        switch (name) {
            case 'find':
                return this.checkFind(args);
            case 'rg':
                return args.some(arg => RG_FORBIDDEN_ARG_RE.test(arg.value))
                    ? 'rg flag runs a program or reads hidden/ignored files' : undefined;
            case 'fd':
            case 'fdfind':
                return args.some(arg => FD_FORBIDDEN_ARG_RE.test(arg.value)) ? 'fd --exec' : undefined;
            case 'grep':
            case 'egrep':
            case 'fgrep':
                return args.some(arg => GREP_RECURSIVE_ARG_RE.test(arg.value)) ? 'recursive grep reads every file' : undefined;
            case 'diff':
                return args.some(arg => /^-[^-]*r|^--recursive$/.test(arg.value)) ? 'recursive diff reads every file' : undefined;
            case 'jq':
                // `env` / `$ENV` dump the process environment (API keys).
                return args.some(arg => /\benv\b|\$ENV|input_filename/.test(arg.value)) ? 'jq reads the environment' : undefined;
            case 'sort':
                return args.some(arg => /^--(?:output|compress-program)(?:=|$)/.test(arg.value) || /^-[a-zA-Z]*o/.test(arg.value))
                    ? 'sort writes a file or runs a compressor' : undefined;
            case 'tree':
                // `-o` writes a file; `-R` re-runs tree with `-o 00Tree.html` in every directory.
                return args.some(arg => /^-[a-zA-Z]*[oR]|^--output/.test(arg.value)) ? 'tree writes a file' : undefined;
            case 'file':
                return args.some(arg => /^-[a-zA-Z]*C|^--compile$/.test(arg.value)) ? 'file -C writes a magic file' : undefined;
            case 'date':
                return args.every(arg => DATE_READ_ARG_RE.test(arg.value)) ? undefined : 'date may set the clock';
            case 'uniq':
                return args.filter(arg => !arg.value.startsWith('-')).length > 1 ? 'uniq with an output file' : undefined;
            case 'sed':
                return this.checkSed(args);
            case 'printf':
                return args.some(arg => arg.value === '-v') ? 'printf -v assigns a variable' : undefined;
            case 'git':
                return this.checkGit(args);
        }
        return ANY_ARGS_COMMANDS.has(name) ? undefined : `not a known read-only command: ${name}`;
    }

    /** Every argument (and `--flag=value` value) must be a non-sensitive path inside the working directory. */
    protected checkPathArguments(words: QaapShellWord[], location: string[], cwd: string | undefined, paths?: string[]): string | undefined {
        for (const word of words.slice(1)) {
            const value = word.value;
            const eq = value.startsWith('-') ? value.indexOf('=') : -1;
            const target = eq >= 0 ? value.slice(eq + 1) : value;
            const reason = (word.glob ? this.checkGlobWord(target) : undefined) ?? this.checkPathWord(target, location, cwd);
            if (reason) {
                return reason;
            }
            if (paths && target && !target.startsWith('-')) {
                paths.push(this.describePath(target, location));
            }
        }
        return undefined;
    }

    /**
     * Globs expand after classification, so check what they COULD match: a segment starting with `.`
     * may match `..` (bash < 5.2) or a dotfile secret; any segment that could match a sensitive name
     * (`.en?`, `id_r*`, `*`) is rejected too.
     */
    protected checkGlobWord(word: string): string | undefined {
        for (const segment of word.replace(/\\/g, '/').split('/')) {
            if (!/[*?[]/.test(segment)) {
                continue;
            }
            if (segment.startsWith('.')) {
                return `glob may match a hidden file or ..: ${word}`;
            }
            const pattern = globSegmentToRegExp(segment);
            const secret = SENSITIVE_SAMPLE_NAMES.find(name => !name.startsWith('.') && pattern.test(name));
            if (secret) {
                return `glob may match a sensitive file (${secret}): ${word}`;
            }
        }
        return undefined;
    }

    /** Path of an argument relative to the task cwd (posix separators), or the absolute path as given. */
    protected describePath(value: string, location: string[]): string {
        const normalized = value.replace(/\\/g, '/');
        if (normalized.startsWith('/') || WINDOWS_DRIVE_RE.test(normalized)) {
            return normalized;
        }
        return [...location, normalized].join('/');
    }

    /** Returns a rejection reason for a word that names a sensitive file or a path outside the cwd. */
    protected checkPathWord(word: string, location: string[], cwd: string | undefined): string | undefined {
        const value = word.replace(/\\/g, '/');
        if (value.split(/[/:=]/).some(component => SENSITIVE_PATH_COMPONENT_RE.test(component))) {
            return `sensitive path: ${word}`;
        }
        if (value.startsWith('~')) {
            return `home-relative path: ${word}`;
        }
        if (value.startsWith('/') || WINDOWS_DRIVE_RE.test(value)) {
            return this.isInsideCwd(value, cwd) ? undefined : `absolute path outside the working directory: ${word}`;
        }
        if (/^[A-Za-z]:/.test(value)) {
            return `drive-relative path: ${word}`;
        }
        if ((value.includes('/') || value === '..') && !this.resolveRelative(value, location)) {
            return `path escapes the working directory: ${word}`;
        }
        return undefined;
    }

    /** Resolves a relative path against `location`; `undefined` when it climbs above the cwd. */
    protected resolveRelative(value: string, location: string[]): string[] | undefined {
        const normalized = value.replace(/\\/g, '/');
        if (normalized.startsWith('/') || normalized.startsWith('~') || WINDOWS_DRIVE_RE.test(normalized) || normalized === '-') {
            return undefined;
        }
        const result = [...location];
        for (const segment of normalized.split('/')) {
            if (!segment || segment === '.') {
                continue;
            }
            if (segment === '..') {
                if (!result.length) {
                    return undefined;
                }
                result.pop();
            } else {
                result.push(segment);
            }
        }
        return result;
    }

    /** Lexical containment check (no symlink resolution); Windows drive paths compare case-insensitively. */
    protected isInsideCwd(absolute: string, cwd: string | undefined): boolean {
        if (!cwd) {
            return false;
        }
        const root = this.canonicalAbsolute(cwd);
        const target = this.canonicalAbsolute(absolute);
        return !!root && !!target && target.length >= root.length && root.every((segment, index) => segment === target[index]);
    }

    protected canonicalAbsolute(input: string): string[] | undefined {
        const text = input.replace(/\\/g, '/');
        const drive = WINDOWS_DRIVE_RE.exec(text);
        if (!drive && !text.startsWith('/')) {
            return undefined;
        }
        const parts: string[] = drive ? [`${drive[1].toLowerCase()}:`] : [];
        const floor = parts.length;
        for (const segment of text.slice(drive ? 3 : 1).split('/')) {
            if (!segment || segment === '.') {
                continue;
            }
            if (segment === '..') {
                if (parts.length <= floor) {
                    return undefined;
                }
                parts.pop();
            } else {
                parts.push(drive ? segment.toLowerCase() : segment);
            }
        }
        return parts;
    }

    protected checkFind(args: QaapShellWord[]): string | undefined {
        for (const arg of args) {
            if (arg.glob) {
                return 'unquoted glob in find arguments';
            }
            if (FIND_FORBIDDEN_PRIMARIES.has(arg.value)) {
                return `find ${arg.value}`;
            }
        }
        return undefined;
    }

    protected checkSed(args: QaapShellWord[]): string | undefined {
        let sawScript = false;
        for (const arg of args) {
            const value = arg.value;
            if (value === '-n' || value === '--quiet' || value === '--silent' || value === '-E' || value === '-r') {
                continue;
            }
            if (value.startsWith('-')) {
                return `sed ${value}`;
            }
            if (!sawScript) {
                if (!SED_PRINT_SCRIPT_RE.test(value)) {
                    return 'sed script is not a plain print range';
                }
                sawScript = true;
            }
        }
        return sawScript ? undefined : 'sed without a script';
    }

    protected checkGit(args: QaapShellWord[]): string | undefined {
        let index = 0;
        // Only harmless global flags; `-c`, `-C`, `--git-dir`, `--work-tree`, `--exec-path` … are rejected.
        while (index < args.length && args[index].value.startsWith('-')) {
            const flag = args[index].value;
            if (flag !== '--no-pager' && flag !== '--no-optional-locks' && flag !== '-P') {
                return `git global option ${flag}`;
            }
            index++;
        }
        const subcommand = args[index]?.value;
        const rest = args.slice(index + 1);
        if (!subcommand) {
            return 'git without a subcommand';
        }
        if (rest.some(arg => arg.glob)) {
            return 'unquoted glob in git arguments';
        }
        const forbidden = rest.find(arg => GIT_FORBIDDEN_SHORT_FLAG_RE.test(arg.value)
            || isLongOptionPrefix(arg.value, GIT_FORBIDDEN_LONG_OPTIONS)
            || isLongOptionPrefix(arg.value, GIT_UNTRACKED_READ_LONG_OPTIONS));
        if (forbidden) {
            return `git ${subcommand} ${forbidden.value}`;
        }
        if (GIT_READONLY_SUBCOMMANDS.has(subcommand)) {
            return undefined;
        }
        switch (subcommand) {
            case 'branch':
                return this.checkGitListing(rest, GIT_BRANCH_LIST_FLAGS_RE, 'branch');
            case 'tag':
                return this.checkGitListing(rest, GIT_TAG_LIST_FLAGS_RE, 'tag');
            case 'remote':
                if (rest.length === 0 || (rest.length === 1 && (rest[0].value === '-v' || rest[0].value === '--verbose'))) {
                    return undefined;
                }
                return rest[0].value === 'get-url' ? undefined : 'git remote with a mutating subcommand';
            case 'stash':
                return rest[0]?.value === 'list' || rest[0]?.value === 'show' ? undefined : 'git stash mutates';
            case 'reflog':
                return rest.length === 0 || rest[0].value === 'show' || rest[0].value.startsWith('-') ? undefined : 'git reflog mutates';
            case 'worktree':
                return rest[0]?.value === 'list' ? undefined : 'git worktree mutates';
            case 'config':
                return this.checkGitConfig(rest);
        }
        return `git ${subcommand} is not read-only`;
    }

    /** `git branch` / `git tag`: listing flags only; positional args are patterns only with `--list`/`-l`. */
    protected checkGitListing(rest: QaapShellWord[], allowedFlags: RegExp, name: string): string | undefined {
        const listing = rest.some(arg => arg.value === '-l' || arg.value === '--list');
        let expectsValue = false;
        for (const arg of rest) {
            if (expectsValue) {
                expectsValue = false;
                continue;
            }
            if (arg.value.startsWith('-')) {
                if (!allowedFlags.test(arg.value)) {
                    return `git ${name} ${arg.value}`;
                }
                expectsValue = GIT_LISTING_VALUE_FLAGS.has(arg.value);
            } else if (!listing) {
                return `git ${name} ${arg.value} creates or changes a ref`;
            }
        }
        return undefined;
    }

    protected checkGitConfig(rest: QaapShellWord[]): string | undefined {
        const readMode = rest.some(arg => ['--get', '--get-all', '--get-regexp', '--list', '-l', '--get-urlmatch'].includes(arg.value))
            || rest[0]?.value === 'get' || rest[0]?.value === 'list';
        if (!readMode) {
            return 'git config write';
        }
        const flags = rest.filter(arg => arg.value.startsWith('-'));
        const unknown = flags.find(arg => !GIT_CONFIG_READ_FLAGS.has(arg.value));
        return unknown ? `git config ${unknown.value}` : undefined;
    }
}

export namespace QaapBashReadOnlyClassifier {
    const shared = new QaapBashReadOnlyClassifier();

    /** Convenience wrapper over a shared default classifier instance. */
    export function classifyCommand(command: string | undefined, options?: QaapBashReadOnlyClassifyOptions): QaapBashReadOnlyClassification {
        return shared.classify(command, options);
    }
}
