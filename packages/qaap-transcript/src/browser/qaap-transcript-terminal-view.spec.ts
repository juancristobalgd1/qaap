// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { Widget as LuminoWidget } from '@lumino/widgets';
import type { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import {
    cancelDisposedTerminalPausedResize,
    createTranscriptTerminalStagingHost,
    createTranscriptTerminalSurface,
    type TranscriptTerminalViewServices,
} from './qaap-transcript-terminal-view';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

/**
 * Mirrors xterm 5.3 `DebouncedIdleTask` exactly: `set` replaces the queued closure, `flush` runs it,
 * and there is no `clear()`. The queued closure runs later unless replaced.
 */
class FakeIdleTask {
    protected handle: ReturnType<typeof setTimeout> | undefined;
    constructor(protected readonly errors: unknown[]) { }
    set(task: () => void): void {
        if (this.handle !== undefined) {
            clearTimeout(this.handle);
        }
        this.handle = setTimeout(() => {
            this.handle = undefined;
            try {
                task();
            } catch (error) {
                this.errors.push(error);
            }
        }, 0);
    }
    flush(): void {
        // Not reached by these specs.
    }
}

/**
 * Terminal widget whose dispose replays `TerminalWidgetImpl.dispose` on a paused xterm: the WebGL
 * addon teardown resizes through the render service (deferred while paused), then the core
 * disposes the renderer.
 */
class PausedXtermTerminal extends LuminoWidget {
    readonly errors: unknown[] = [];
    protected readonly renderer: { value: { handleResize(): void } | undefined } = { value: { handleResize: () => undefined } };
    readonly term = {
        _core: {
            _renderService: {
                _pausedResizeTask: new FakeIdleTask(this.errors),
            },
        },
    };
    async start(): Promise<number> {
        return 1;
    }
    override dispose(): void {
        if (this.isDisposed) {
            return;
        }
        const renderer = this.renderer;
        this.term._core._renderService._pausedResizeTask.set(() => renderer.value!.handleResize());
        renderer.value = undefined;
        super.dispose();
    }
}

describe('qaap-transcript-terminal-view', () => {

    useSuiteJSDOM();

    const flushIdle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 5));

    function services(terminal: PausedXtermTerminal): TranscriptTerminalViewServices {
        return {
            resolveCwd: cwd => cwd,
            createTerminal: async () => terminal as unknown as TerminalWidget,
            restoreTerminal: async () => terminal as unknown as TerminalWidget,
            loadWorkspaceState: async () => undefined,
            saveWorkspaceState: async () => undefined,
            localize: (_key, defaultValue) => defaultValue,
        };
    }

    it('reproduces the deferred resize that throws once a paused terminal is disposed', async () => {
        const terminal = new PausedXtermTerminal();
        terminal.dispose();
        await flushIdle();
        expect(terminal.errors).to.have.length(1);
        expect(String(terminal.errors[0])).to.contain('handleResize');
    });

    it('disposing a staged surface (agent login dialog close) leaves no deferred resize behind', async () => {
        const frameHost = globalThis as { requestAnimationFrame?: (callback: () => void) => unknown };
        const originalRequestAnimationFrame = frameHost.requestAnimationFrame;
        frameHost.requestAnimationFrame = callback => setTimeout(callback, 0);
        try {
            const terminal = new PausedXtermTerminal();
            const staging = createTranscriptTerminalStagingHost();
            const surface = await createTranscriptTerminalSurface(staging, '/workspace/project', services(terminal));

            surface.dispose.dispose();
            await flushIdle();

            expect(terminal.isDisposed).to.equal(true);
            expect(terminal.errors).to.deep.equal([]);
            expect(staging.isConnected).to.equal(false);
        } finally {
            frameHost.requestAnimationFrame = originalRequestAnimationFrame;
        }
    });

    it('the fake idle task matches the DebouncedIdleTask of the xterm bundle the IDE ships', () => {
        const terminalPackage = path.dirname(require.resolve('@theia/terminal/package.json'));
        const bundle = fs.readFileSync(require.resolve('xterm/lib/xterm.js', { paths: [terminalPackage] }), 'utf8');
        const debouncedIdleTask = /DebouncedIdleTask=class\{(.*?)\}\}/.exec(bundle)?.[1];
        expect(debouncedIdleTask, 'DebouncedIdleTask not found in the xterm bundle').to.be.a('string');
        const methods = [...debouncedIdleTask!.matchAll(/(?:^|\})(\w+)\(/g)].map(match => match[1]).sort();
        expect(methods).to.deep.equal(Object.getOwnPropertyNames(FakeIdleTask.prototype).sort());
    });

    it('ignores terminals without xterm internals', () => {
        expect(() => cancelDisposedTerminalPausedResize({} as TerminalWidget)).not.to.throw();
    });
});
