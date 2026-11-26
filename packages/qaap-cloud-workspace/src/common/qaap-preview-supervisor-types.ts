// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Public path of the authenticated dev-preview restart endpoint. */
export const QAAP_PREVIEW_RESTART_PATH = '/qaap/api/cloud/preview/restart';

/** Bounded auto-restart policy for supervisor-owned dev servers. */
export const QAAP_PREVIEW_AUTO_RESTART_WINDOW_MS = 10 * 60 * 1000;
export const QAAP_PREVIEW_AUTO_RESTART_MAX = 2;

export interface QaapPreviewRestartRequest {
    readonly port: number;
    readonly cwd: string;
    readonly projectId?: string;
    readonly conversationId?: string;
    readonly runId?: string;
    readonly workspaceId?: string;
    readonly processId?: string;
}

export interface QaapPreviewProcessIdentity {
    readonly previewId: string;
    readonly projectId: string;
    readonly conversationId?: string;
    readonly runId?: string;
    readonly userId?: string;
    readonly workspaceId?: string;
    readonly processId?: string;
    readonly ownerLogin?: string;
}

export type QaapPreviewProcessStatus = 'starting' | 'running' | 'exited';

/** Snapshot of a supervised dev-server child, safe to serialize / render. */
export interface QaapPreviewProcessSnapshot {
    readonly previewId?: string;
    readonly port: number;
    readonly cwd: string;
    readonly status: QaapPreviewProcessStatus;
    readonly startedAt?: string;
    readonly exitedAt?: string;
    readonly exitCode?: number;
    readonly signal?: string;
    readonly stderrTail: string[];
    /** Timestamps (ms) of automatic restarts within the current window. */
    readonly autoRestartAt: number[];
    readonly processId?: number;
    /** Argv the child was started with (after package-manager resolution, before any sandbox wrapping). */
    readonly launch?: { readonly command: string; readonly args: readonly string[] };
}

/**
 * Fixed-capacity ring of the most recent stderr (and fatal stdout) lines, resilient to
 * chunked stream data that does not align on line boundaries. Kept pure/DOM-free so it can
 * be unit tested and reused by the failure page renderer.
 */
export class QaapStderrRing {

    protected readonly lines: string[] = [];
    protected partial = '';

    constructor(protected readonly maxLines: number = 40) { }

    /** Appends a raw stream chunk, retaining only the last {@link maxLines} complete lines. */
    push(chunk: string): void {
        if (!chunk) {
            return;
        }
        this.partial += chunk;
        const segments = this.partial.split('\n');
        this.partial = segments.pop() ?? '';
        for (const segment of segments) {
            this.lines.push(segment.replace(/\r$/, ''));
        }
        this.trim();
    }

    /** Returns the retained lines, including any unterminated trailing line. */
    snapshot(): string[] {
        const all = this.partial ? [...this.lines, this.partial.replace(/\r$/, '')] : [...this.lines];
        return all.slice(-this.maxLines);
    }

    protected trim(): void {
        const overflow = this.lines.length - this.maxLines;
        if (overflow > 0) {
            this.lines.splice(0, overflow);
        }
    }
}

export type QaapPreviewLogStreamName = 'stdout' | 'stderr' | 'qaap';

export interface QaapPreviewLogLine {
    readonly at: number;
    readonly stream: QaapPreviewLogStreamName;
    readonly text: string;
}

/** Default caps of {@link QaapPreviewLogRing}: enough for a build log, bounded per preview. */
export const QAAP_PREVIEW_LOG_MAX_LINES = 2000;
export const QAAP_PREVIEW_LOG_MAX_BYTES = 512 * 1024;
const QAAP_PREVIEW_LOG_MAX_LINE_CHARS = 4000;

/** Strips ANSI escape sequences (colors, cursor moves) that dev servers print to terminals. */
export function stripQaapAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g, '');
}

/**
 * Full output of one supervised dev server: stdout and stderr lines (ANSI-stripped, timestamped, tagged), kept
 * up to {@link QAAP_PREVIEW_LOG_MAX_LINES} lines and {@link QAAP_PREVIEW_LOG_MAX_BYTES}; older lines are dropped
 * and counted. Partial lines are buffered per stream until their newline (or a flush).
 */
export class QaapPreviewLogRing {

    protected readonly lines: QaapPreviewLogLine[] = [];
    protected readonly partial: Record<QaapPreviewLogStreamName, string> = { stdout: '', stderr: '', qaap: '' };
    protected bytes = 0;
    protected dropped = 0;

    constructor(
        protected readonly maxLines: number = QAAP_PREVIEW_LOG_MAX_LINES,
        protected readonly maxBytes: number = QAAP_PREVIEW_LOG_MAX_BYTES,
        protected readonly now: () => number = Date.now,
    ) { }

    /** Appends a raw stream chunk; complete lines are stored, a trailing partial line waits for more. */
    push(stream: QaapPreviewLogStreamName, chunk: string): void {
        if (!chunk) {
            return;
        }
        const segments = (this.partial[stream] + chunk).split('\n');
        this.partial[stream] = segments.pop() ?? '';
        if (this.partial[stream].length > QAAP_PREVIEW_LOG_MAX_LINE_CHARS) {
            segments.push(this.partial[stream]);
            this.partial[stream] = '';
        }
        for (const segment of segments) {
            this.add(stream, segment);
        }
    }

    /** Stores any buffered partial lines (call on exit so the last line before a crash is kept). */
    flush(): void {
        for (const stream of Object.keys(this.partial) as QaapPreviewLogStreamName[]) {
            if (this.partial[stream]) {
                this.add(stream, this.partial[stream]);
                this.partial[stream] = '';
            }
        }
    }

    /** The newest `count` lines (optionally of one stream and/or containing `grep`, case-insensitive). */
    tail(count: number, options: { readonly stream?: 'all' | 'stdout' | 'stderr'; readonly grep?: string } = {}): QaapPreviewLogLine[] {
        const needle = options.grep?.toLowerCase();
        const pending = (Object.keys(this.partial) as QaapPreviewLogStreamName[])
            .filter(stream => this.partial[stream])
            .map(stream => ({ at: this.now(), stream, text: this.clean(this.partial[stream]) }));
        const all = [...this.lines, ...pending].filter(line => (!options.stream || options.stream === 'all'
            || line.stream === options.stream || line.stream === 'qaap')
            && (!needle || line.text.toLowerCase().includes(needle)));
        return count > 0 ? all.slice(-count) : [];
    }

    /** Lines dropped from the front to respect the caps. */
    droppedLines(): number {
        return this.dropped;
    }

    protected add(stream: QaapPreviewLogStreamName, raw: string): void {
        const text = this.clean(raw);
        this.lines.push({ at: this.now(), stream, text });
        this.bytes += text.length + 1;
        while (this.lines.length > this.maxLines || (this.bytes > this.maxBytes && this.lines.length > 1)) {
            const removed = this.lines.shift()!;
            this.bytes -= removed.text.length + 1;
            this.dropped++;
        }
    }

    protected clean(raw: string): string {
        const text = stripQaapAnsi(raw.replace(/\r$/, ''));
        // A progress bar rewrites one line with `\r`: keep only what it last showed.
        const lastFrame = text.includes('\r') ? text.slice(text.lastIndexOf('\r') + 1) : text;
        return lastFrame.length > QAAP_PREVIEW_LOG_MAX_LINE_CHARS ? `${lastFrame.slice(0, QAAP_PREVIEW_LOG_MAX_LINE_CHARS)}…` : lastFrame;
    }
}

/**
 * Bounded auto-restart decision. Returns true only when fewer than {@link max} restarts have
 * occurred within the trailing {@link windowMs}. Prevents restart storms on apps that crash on
 * boot: after the cap is reached the supervisor stops and leaves the friendly failure page up.
 */
export function shouldAutoRestartPreview(
    priorRestartsAt: readonly number[],
    now: number,
    windowMs: number = QAAP_PREVIEW_AUTO_RESTART_WINDOW_MS,
    max: number = QAAP_PREVIEW_AUTO_RESTART_MAX,
): boolean {
    const cutoff = now - windowMs;
    const recent = priorRestartsAt.filter(at => at >= cutoff);
    return recent.length < max;
}

/** Drops restart timestamps outside the trailing window. */
export function pruneRestartHistory(priorRestartsAt: readonly number[], now: number, windowMs: number = QAAP_PREVIEW_AUTO_RESTART_WINDOW_MS): number[] {
    const cutoff = now - windowMs;
    return priorRestartsAt.filter(at => at >= cutoff);
}

export function escapeQaapHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export interface QaapPreviewFailurePageOptions {
    readonly port: number;
    /** Absolute cwd used to restart; when absent the Restart button is disabled. */
    readonly cwd?: string;
    readonly exitCode?: number;
    readonly signal?: string;
    readonly stderrTail?: string[];
    /** True once the dev server had been observed at least once (crashed vs never started). */
    readonly everStarted?: boolean;
    /** Endpoint the Restart button POSTs to. Defaults to {@link QAAP_PREVIEW_RESTART_PATH}. */
    readonly restartPath?: string;
}

/**
 * Renders a minimal, self-contained failure page shown by the preview proxy when the dev server
 * is unreachable. No external assets: inline CSS + a small script that restarts the server via the
 * authenticated endpoint (same-origin cookies) and then polls by reloading until it is back.
 */
export function buildQaapPreviewFailureHtml(options: QaapPreviewFailurePageOptions): string {
    const port = String(options.port);
    const restartPath = options.restartPath ?? QAAP_PREVIEW_RESTART_PATH;
    const cwd = options.cwd;
    const canRestart = typeof cwd === 'string' && cwd.length > 0;
    const exitBits: string[] = [];
    if (typeof options.exitCode === 'number') {
        exitBits.push(`exit code ${options.exitCode}`);
    }
    if (options.signal) {
        exitBits.push(`signal ${options.signal}`);
    }
    const exitLine = exitBits.length > 0
        ? `The dev server on port ${port} stopped (${exitBits.join(', ')}).`
        : options.everStarted
            ? `The dev server on port ${port} is no longer responding.`
            : `No dev server is running on port ${port}.`;
    const tail = (options.stderrTail ?? []).filter(line => line.length > 0);
    const logBlock = tail.length > 0
        ? `<details id="logs"><summary>View logs</summary><pre class="log">${escapeQaapHtml(tail.join('\n'))}</pre></details>`
        : '<details id="logs"><summary>View logs</summary><p class="muted">No recent server output was captured.</p></details>';
    const restartControl = canRestart
        ? '<button id="restart" type="button">Restart Preview</button>'
        : '<p class="muted">Restart is unavailable here — reopen the project to start the dev server.</p>';
    const diagnostic = [
        'Qaap Preview diagnostic',
        `status: ${exitLine}`,
        `port: ${options.port}`,
        `workspace: ${cwd ?? '(unknown)'}`,
        `exitCode: ${options.exitCode ?? '(none)'}`,
        `signal: ${options.signal ?? '(none)'}`,
        `everStarted: ${options.everStarted === true}`,
        tail.length > 0 ? `serverOutput:\n${tail.join('\n')}` : 'serverOutput: (none captured)',
    ].join('\n');
    // JSON embedded in a script must not be allowed to terminate that script from captured output.
    const configJson = JSON.stringify({ port: options.port, cwd: cwd ?? '', restartPath, diagnostic })
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview unavailable</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0d1117; color: #e6edf3; font-family: system-ui, sans-serif; padding: 1.5rem; }
  .card { width: 100%; max-width: 36rem; }
  h1 { font-size: 1.05rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { font-size: 0.9rem; color: #b9c2cc; margin: 0 0 0.75rem; line-height: 1.5; }
  .muted { color: #8b949e; }
  details { margin: 0 0 1rem; }
  summary { color: #58a6ff; cursor: pointer; font-size: 0.85rem; margin-bottom: 0.5rem; }
  .log { background: #010409; border: 1px solid #30363d; border-radius: 6px; padding: 0.75rem 1rem;
    font-family: ui-monospace, monospace; font-size: 0.78rem; color: #c9d1d9; line-height: 1.45;
    white-space: pre-wrap; word-break: break-word; max-height: 15rem; overflow: auto; margin: 0 0 1rem; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
  button { appearance: none; border: 0; border-radius: 6px; background: #238636; color: #fff;
    font-size: 0.9rem; font-weight: 600; padding: 0.55rem 1.1rem; cursor: pointer; }
  button.secondary { background: #21262d; border: 1px solid #30363d; }
  button:disabled { opacity: 0.6; cursor: default; }
  #status { font-size: 0.85rem; color: #8b949e; margin-top: 0.75rem; min-height: 1.2rem; }
</style>
</head>
<body>
  <div class="card">
    <h1>Preview is not running</h1>
    <p>${escapeQaapHtml(exitLine)}</p>
    ${logBlock}
    <div class="actions">
      ${restartControl}
      <button id="copy-diagnostic" class="secondary" type="button">Copy diagnostic</button>
    </div>
    <div id="status" role="status"></div>
  </div>
  <script>
    (function () {
      var cfg = ${configJson};
      var btn = document.getElementById('restart');
      var copyBtn = document.getElementById('copy-diagnostic');
      var status = document.getElementById('status');
      var polling = false;
      function copyText(value) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(value);
        }
        var area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        var copied = document.execCommand('copy');
        area.remove();
        return copied ? Promise.resolve() : Promise.reject(new Error('Clipboard unavailable'));
      }
      if (copyBtn) {
        copyBtn.addEventListener('click', function () {
          copyBtn.disabled = true;
          copyText(cfg.diagnostic).then(function () {
            status.textContent = 'Diagnostic copied.';
          }).catch(function (err) {
            status.textContent = 'Could not copy the diagnostic (' + err.message + ').';
          }).then(function () {
            copyBtn.disabled = false;
          });
        });
      }
      if (!btn) { return; }
      function poll() {
        setTimeout(function () { location.reload(); }, 2500);
      }
      btn.addEventListener('click', function () {
        if (polling) { return; }
        btn.disabled = true;
        status.textContent = 'Starting dev server…';
        fetch(cfg.restartPath, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ port: cfg.port, cwd: cfg.cwd })
        }).then(function (res) {
          if (!res.ok) { throw new Error('HTTP ' + res.status); }
          polling = true;
          status.textContent = 'Dev server starting — this page will reload automatically.';
          poll();
        }).catch(function (err) {
          btn.disabled = false;
          status.textContent = 'Could not restart the dev server (' + err.message + ').';
        });
      });
    })();
  </script>
</body>
</html>`;
}
