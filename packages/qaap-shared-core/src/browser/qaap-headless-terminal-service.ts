// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import URI from '@theia/core/lib/common/uri';
import { RemoteConnectionProvider, ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import type { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import type { TerminalWidgetOptions } from '@theia/terminal/lib/browser/base/terminal-widget';
import type { TerminalWatcher } from '@theia/terminal/lib/common/terminal-watcher';

/**
 * Mobile process runner for the project bootstrap (install / dev server) without `@theia/terminal`
 * and without xterm.
 *
 * It talks to the very same backend the IDE terminal uses underneath: the shell terminal RPC server
 * (`/services/shell-terminal`, which spawns through the tenant spawn wrapper exactly like an IDE
 * terminal) and the per-terminal output channel (`/services/terminals/<id>`). Each run is a
 * {@link QaapHeadlessTerminal}: the subset of `TerminalWidget` the bootstrap service relies on
 * (output events, exit status, a plain-text line buffer for the log tail, process id/info, dispose).
 *
 * The paths and the exit-reason numbers mirror `@theia/terminal/lib/common/*` on purpose: importing
 * them would pull the terminal package into the `bundle-mobile` entry.
 */

/** `shellTerminalPath` from `@theia/terminal/lib/common/shell-terminal-protocol`. */
export const QAAP_SHELL_TERMINAL_PATH = '/services/shell-terminal';
/** `terminalsPath` from `@theia/terminal/lib/common/terminal-protocol`. */
export const QAAP_TERMINALS_PATH = '/services/terminals';

/** `TerminalExitReason` of `@theia/terminal/lib/common/base-terminal-protocol`. */
const EXIT_REASON_PROCESS = 2;
const EXIT_REASON_EXTENSION = 4;

/** Lines kept in a headless terminal's buffer (the bootstrap card reads the last 40). */
const MAX_BUFFER_LINES = 1000;

/** Default xterm geometry of a terminal widget that was never attached (what mobile used before). */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export interface QaapHeadlessTerminalExitEvent {
    readonly terminalId: number;
    readonly code?: number;
    readonly reason?: number;
    readonly signal?: string;
    readonly attached?: boolean;
}

/** The RPC surface of `IShellTerminalServer` the runner uses. */
export interface QaapShellTerminalServer {
    create(options: {
        shell?: string; args?: string[] | string; rootURI?: string; cols?: number; rows?: number;
        env?: { [key: string]: string | null }; strictEnv?: boolean; isPseudo?: boolean; enableShellIntegration?: boolean;
    }): Promise<number>;
    getProcessId(id: number): Promise<number>;
    getProcessInfo(id: number): Promise<{ executable: string; arguments: string[] }>;
    onAttachAttempted(id: number): Promise<void>;
    close(id: number): Promise<void>;
}

/** Strips ANSI/VT control sequences; what an xterm buffer row would show as text. */
export function stripTerminalControlSequences(text: string): string {
    return text
        // OSC ... BEL / ST
        // eslint-disable-next-line no-control-regex
        .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
        // CSI sequences
        // eslint-disable-next-line no-control-regex
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
        // Other two-character escapes
        // eslint-disable-next-line no-control-regex
        .replace(/\u001b[@-Z\\-_]/g, '')
        // Remaining C0 controls except \n, \r and \t
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** Plain-text line buffer with xterm-like `\r` (carriage return) handling. */
export class QaapHeadlessTerminalBuffer {
    protected readonly lines: string[] = [''];

    get length(): number {
        return this.lines.length;
    }

    write(data: string): void {
        const text = stripTerminalControlSequences(data);
        for (let index = 0; index < text.length; index++) {
            const char = text[index];
            const last = this.lines.length - 1;
            if (char === '\n') {
                this.lines.push('');
            } else if (char === '\r') {
                if (text[index + 1] !== '\n') {
                    // A bare carriage return redraws the line (progress bars, spinners).
                    this.lines[last] = '';
                }
            } else {
                this.lines[last] += char;
            }
        }
        if (this.lines.length > MAX_BUFFER_LINES) {
            this.lines.splice(0, this.lines.length - MAX_BUFFER_LINES);
        }
    }

    getLines(start: number, length: number, trimRight?: boolean): string[] {
        return this.lines.slice(Math.max(0, start), Math.max(0, start) + Math.max(0, length))
            .map(line => trimRight ? line.replace(/\s+$/, '') : line);
    }
}

/** One headless run: the `TerminalWidget` subset used by `QaapProjectBootstrapService`. */
export class QaapHeadlessTerminal implements Disposable {
    readonly buffer = new QaapHeadlessTerminalBuffer();
    readonly title: { label: string };
    readonly kind: string;
    readonly hiddenFromUser = true;
    readonly lastCwd: URI | undefined;
    exitStatus: { readonly code: number | undefined; readonly reason: number } | undefined;

    protected _terminalId = -1;
    protected disposed = false;
    protected readonly toDispose = new DisposableCollection();
    protected readonly onOutputEmitter = new Emitter<string>();
    protected readonly onDataEmitter = new Emitter<string>();
    protected readonly onDidCloseEmitter = new Emitter<QaapHeadlessTerminal>();

    readonly onOutput: Event<string> = this.onOutputEmitter.event;
    /** User input; a headless run never has any. */
    readonly onData: Event<string> = this.onDataEmitter.event;
    readonly onTerminalDidClose: Event<QaapHeadlessTerminal> = this.onDidCloseEmitter.event;

    constructor(
        readonly id: string,
        protected readonly options: TerminalWidgetOptions,
        protected readonly server: QaapShellTerminalServer,
        protected readonly connectionProvider: ServiceConnectionProvider,
        protected readonly onDidDispose: (terminal: QaapHeadlessTerminal) => void,
    ) {
        this.title = { label: options.title ?? 'Terminal' };
        this.kind = options.kind ?? 'user';
        this.lastCwd = typeof options.cwd === 'string' ? URI.fromFilePath(options.cwd) : options.cwd;
        this.toDispose.pushAll([this.onOutputEmitter, this.onDataEmitter]);
    }

    get terminalId(): number {
        return this._terminalId;
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    get processId(): Promise<number> {
        return this.server.getProcessId(this._terminalId);
    }

    get processInfo(): Promise<{ executable: string; arguments: string[] }> {
        return this.server.getProcessInfo(this._terminalId);
    }

    async start(): Promise<number> {
        const terminalId = await this.server.create({
            shell: this.options.shellPath,
            args: this.options.shellArgs,
            env: this.options.env,
            strictEnv: this.options.strictEnv,
            rootURI: this.options.cwd?.toString(),
            cols: DEFAULT_COLS,
            rows: DEFAULT_ROWS,
            enableShellIntegration: false,
        });
        if (typeof terminalId !== 'number' || terminalId === -1) {
            throw new Error('Failed to start terminal.');
        }
        this._terminalId = terminalId;
        this.connectOutput();
        await this.server.onAttachAttempted(terminalId);
        return terminalId;
    }

    protected connectOutput(): void {
        this.connectionProvider.listen(`${QAAP_TERMINALS_PATH}/${this._terminalId}`, (_path, channel) => {
            channel.onMessage(event => {
                if (this.disposed) {
                    return;
                }
                const data = event().readString();
                this.buffer.write(data);
                this.onOutputEmitter.fire(data);
            });
        }, false);
    }

    /** Called by the runner for the backend exit event of this terminal (same semantics as the widget). */
    handleExit(event: QaapHeadlessTerminalExitEvent): void {
        this.exitStatus = { code: event.code, reason: event.reason || EXIT_REASON_PROCESS };
    }

    /** Called by the runner for the backend error event of this terminal. */
    handleError(): void {
        this.exitStatus = { code: undefined, reason: EXIT_REASON_PROCESS };
        this.dispose();
    }

    kill(): Promise<void> {
        return this._terminalId === -1 ? Promise.resolve() : this.server.close(this._terminalId);
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        if (this._terminalId !== -1 && !this.exitStatus?.code) {
            // Like a `TerminalWidget` closed explicitly: stop the backend process.
            void this.server.close(this._terminalId).catch(() => undefined);
            this.exitStatus = { code: undefined, reason: EXIT_REASON_EXTENSION };
        }
        if (this.exitStatus) {
            this.onDidCloseEmitter.fire(this);
        }
        this.onDidCloseEmitter.dispose();
        this.toDispose.dispose();
        this.onDidDispose(this);
    }
}

/**
 * Mobile replacement for the `TerminalService` + `TerminalWatcher` pair the project bootstrap uses.
 * Bound only in the `bundle-mobile` entry (`qaap-work-hub-mobile-frontend-module`); desktop keeps
 * the real terminal through the IDE bridge.
 */
@injectable()
export class QaapHeadlessTerminalService {

    @inject(RemoteConnectionProvider)
    protected readonly connectionProvider: ServiceConnectionProvider;

    protected readonly terminals: QaapHeadlessTerminal[] = [];
    protected readonly onTerminalExitEmitter = new Emitter<QaapHeadlessTerminalExitEvent>();
    protected readonly onTerminalErrorEmitter = new Emitter<{ terminalId: number; error: Error; attached?: boolean }>();
    protected serverProxy: QaapShellTerminalServer | undefined;
    protected nextId = 0;

    readonly onTerminalExit: Event<QaapHeadlessTerminalExitEvent> = this.onTerminalExitEmitter.event;
    readonly onTerminalError = this.onTerminalErrorEmitter.event;

    get all(): QaapHeadlessTerminal[] {
        return [...this.terminals];
    }

    protected get server(): QaapShellTerminalServer {
        if (!this.serverProxy) {
            this.serverProxy = this.connectionProvider.createProxy<QaapShellTerminalServer & object>(QAAP_SHELL_TERMINAL_PATH, {
                onTerminalExitChanged: (event: QaapHeadlessTerminalExitEvent) => {
                    this.terminals.find(terminal => terminal.terminalId === event.terminalId)?.handleExit(event);
                    this.onTerminalExitEmitter.fire(event);
                },
                onTerminalError: (event: { terminalId: number; error: Error; attached?: boolean }) => {
                    this.terminals.find(terminal => terminal.terminalId === event.terminalId)?.handleError();
                    this.onTerminalErrorEmitter.fire(event);
                },
                storeTerminalEnvVariables: () => undefined,
                updateTerminalEnvVariables: () => undefined,
            });
        }
        return this.serverProxy;
    }

    async newTerminal(options: TerminalWidgetOptions): Promise<QaapHeadlessTerminal> {
        const terminal = new QaapHeadlessTerminal(`qaap-headless-terminal-${this.nextId++}`, options, this.server,
            this.connectionProvider, disposed => {
                const index = this.terminals.indexOf(disposed);
                if (index !== -1) {
                    this.terminals.splice(index, 1);
                }
            });
        this.terminals.push(terminal);
        return terminal;
    }

    /** Headless runs have no widget to reveal. */
    async open(): Promise<void> { }

    /** The `TerminalService` view of this runner, for the bootstrap service. */
    asTerminalService(): TerminalService {
        return this as unknown as TerminalService;
    }

    /** The `TerminalWatcher` view of this runner, for the bootstrap service. */
    asTerminalWatcher(): TerminalWatcher {
        return this as unknown as TerminalWatcher;
    }
}

