// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const QAAP_PREVIEW_CONFIG_PATH = '.qaap/preview.json';
export const QAAP_PREVIEW_PORT_PLACEHOLDER = '{{PORT}}';

export type QaapPreviewRuntime = 'custom' | 'python' | 'go' | 'rust' | 'dotnet' | 'php';

/**
 * Versioned, argv-shaped preview declaration. Keeping command and arguments separate lets Qaap
 * validate/quote workspace configuration instead of accepting an opaque shell program.
 */
export interface QaapPreviewLaunchPlan {
    readonly version: 1;
    readonly runtime: QaapPreviewRuntime;
    readonly name?: string;
    /** Workspace-relative directory. `.` means the workspace root. */
    readonly cwd: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly port: number;
}

export type QaapPreviewLaunchConfigResult =
    | { readonly ok: true; readonly plan: QaapPreviewLaunchPlan }
    | { readonly ok: false; readonly error: string };

const RUNTIMES = new Set<QaapPreviewRuntime>(['custom', 'python', 'go', 'rust', 'dotnet', 'php']);
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_LENGTH = 1_024;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidControlCharacters(value: string): boolean {
    return /[\0\r\n]/.test(value);
}

/** Parses and fail-closes malformed or path-escaping workspace preview configuration. */
export function parseQaapPreviewLaunchConfig(value: unknown): QaapPreviewLaunchConfigResult {
    if (!isRecord(value)) {
        return { ok: false, error: 'Preview configuration must be a JSON object.' };
    }
    if (value.version !== undefined && value.version !== 1) {
        return { ok: false, error: 'Preview configuration version must be 1.' };
    }
    if (typeof value.runtime !== 'string' || !RUNTIMES.has(value.runtime as QaapPreviewRuntime)) {
        return { ok: false, error: 'Preview runtime must be custom, python, go, rust, dotnet, or php.' };
    }
    if (typeof value.command !== 'string' || value.command.length === 0 || value.command.length > 256
        || invalidControlCharacters(value.command) || /\s/.test(value.command)) {
        return { ok: false, error: 'Preview command must be one executable token without whitespace.' };
    }
    const rawCwd = value.cwd === undefined ? '.' : value.cwd;
    if (typeof rawCwd !== 'string' || rawCwd.length === 0 || rawCwd.length > 512
        || invalidControlCharacters(rawCwd) || rawCwd.includes('\\')) {
        return { ok: false, error: 'Preview cwd must be a workspace-relative POSIX path.' };
    }
    const cwdSegments = rawCwd.split('/').filter(segment => segment.length > 0 && segment !== '.');
    if (rawCwd.startsWith('/') || /^[a-zA-Z]:/.test(rawCwd) || cwdSegments.includes('..')) {
        return { ok: false, error: 'Preview cwd must stay inside the workspace.' };
    }
    const cwd = cwdSegments.length > 0 ? cwdSegments.join('/') : '.';
    const rawArgs = value.args === undefined ? [] : value.args;
    if (!Array.isArray(rawArgs) || rawArgs.length > MAX_ARGUMENTS
        || rawArgs.some(argument => typeof argument !== 'string'
            || argument.length > MAX_ARGUMENT_LENGTH || invalidControlCharacters(argument))) {
        return { ok: false, error: `Preview args must contain at most ${MAX_ARGUMENTS} bounded strings.` };
    }
    if (!Number.isInteger(value.port) || (value.port as number) < 1 || (value.port as number) > 65_535) {
        return { ok: false, error: 'Preview port must be an integer between 1 and 65535.' };
    }
    if (value.name !== undefined && (typeof value.name !== 'string' || value.name.trim().length === 0
        || value.name.length > 120 || invalidControlCharacters(value.name))) {
        return { ok: false, error: 'Preview name must be a non-empty bounded string.' };
    }
    return {
        ok: true,
        plan: {
            version: 1,
            runtime: value.runtime as QaapPreviewRuntime,
            name: typeof value.name === 'string' ? value.name.trim() : undefined,
            cwd,
            command: value.command,
            args: rawArgs as string[],
            port: value.port as number,
        },
    };
}

export function parseQaapPreviewLaunchConfigJson(raw: string): QaapPreviewLaunchConfigResult {
    try {
        return parseQaapPreviewLaunchConfig(JSON.parse(raw));
    } catch {
        return { ok: false, error: 'Preview configuration is not valid JSON.' };
    }
}

/** Replaces the allocator placeholder in an argv plan without evaluating a shell expression. */
export function materializeQaapPreviewLaunchPlan(
    plan: QaapPreviewLaunchPlan,
    port: number,
): { readonly command: string; readonly args: readonly string[] } {
    const replace = (value: string): string => value.replaceAll(QAAP_PREVIEW_PORT_PLACEHOLDER, String(port));
    return { command: replace(plan.command), args: plan.args.map(replace) };
}

function quotePosixArgument(value: string): string {
    return `'${value.replace(/'/g, '\'\\\'\'')}'`;
}

/** Shell rendering used only by the frontend terminal; every token remains individually quoted. */
export function renderQaapPreviewLaunchCommand(plan: QaapPreviewLaunchPlan, platform: 'posix' | 'win32' = 'posix'): string {
    if (platform === 'win32') {
        // The terminal itself is cmd.exe. POSIX single quotes are ordinary characters there, so
        // render the argv plan as a PowerShell call instead. The JSON payload and PowerShell
        // program are base64 encoded, keeping every workspace-controlled argument out of cmd's
        // parser; PowerShell then invokes the executable with an argv array (no shell evaluation).
        const payload = encodeBase64(new TextEncoder().encode(JSON.stringify({ command: plan.command, args: plan.args })));
        const script = [
            `$plan = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
            '$port = [string]$env:QAAP_PREVIEW_PORT',
            "$argv = @($plan.args | ForEach-Object { ([string]$_).Replace('{{PORT}}', $port) })",
            '& $plan.command @argv',
            'if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }',
            'exit 0',
        ].join('; ');
        return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encodeBase64(encodeUtf16Le(script))}`;
    }
    return [plan.command, ...plan.args].map(quotePosixArgument).join(' ');
}

function encodeBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
}

function encodeUtf16Le(value: string): Uint8Array {
    const bytes = new Uint8Array(value.length * 2);
    for (let index = 0; index < value.length; index++) {
        const codeUnit = value.charCodeAt(index);
        bytes[index * 2] = codeUnit & 0xff;
        bytes[index * 2 + 1] = codeUnit >>> 8;
    }
    return bytes;
}
