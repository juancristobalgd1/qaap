// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// xterm and the widget base classes touch the DOM while loading; give them one only for the import.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import { QaapTerminalWidget } from './qaap-terminal-widget';
import { QAAP_PREVIEW_TERMINAL_KIND } from './qaap-preview-terminal-lifecycle';
import { hasQaapUnrenderedOutput } from './qaap-terminal-unrendered-output';

disableImportJSDOM();

/** The widget members the specs drive, plus the xterm writes the fake recorded. */
interface QaapTerminalWidgetHarness {
    write(data: string): void;
    readonly qaapUnrenderedOutput: string;
    readonly onOutputEmitter: Emitter<string>;
    readonly written: string[];
}

/** A widget with only the state `write` touches, without constructing xterm or the DI graph. */
function widgetState(kind: string, opened: boolean = false): QaapTerminalWidgetHarness {
    const state = Object.create(QaapTerminalWidget.prototype) as object;
    const written: string[] = [];
    Object.assign(state, {
        termOpened: opened,
        initialData: '',
        terminalKind: kind,
        term: { write: (data: string) => written.push(data) },
        _currentTerminalOutput: [],
        onOutputEmitter: new Emitter<string>(),
        written,
    });
    return state as QaapTerminalWidgetHarness;
}

describe('QaapTerminalWidget', () => {

    it('reports the output of a hidden preview terminal before its widget is opened', () => {
        const widget = widgetState(QAAP_PREVIEW_TERMINAL_KIND);
        const outputs: string[] = [];
        widget.onOutputEmitter.event(data => outputs.push(data));

        widget.write('sh: vite: command not found\r\n');

        expect(outputs).to.deep.equal(['sh: vite: command not found\r\n']);
        expect(widget.qaapUnrenderedOutput).to.equal('sh: vite: command not found\r\n');
        expect(hasQaapUnrenderedOutput(widget)).to.equal(true);
        // Still kept for upstream to replay into xterm when the widget opens.
        expect(widget.written).to.deep.equal([]);
    });

    it('leaves other hidden terminals with the upstream behaviour', () => {
        const widget = widgetState('user');
        const outputs: string[] = [];
        widget.onOutputEmitter.event(data => outputs.push(data));

        widget.write('hello');

        expect(outputs).to.deep.equal([]);
        expect(widget.qaapUnrenderedOutput).to.equal('hello');
    });

    it('does not report an opened terminal twice: xterm parsing reports it upstream', () => {
        const widget = widgetState(QAAP_PREVIEW_TERMINAL_KIND, true);
        const outputs: string[] = [];
        widget.onOutputEmitter.event(data => outputs.push(data));

        widget.write('ready');

        expect(outputs).to.deep.equal([]);
        expect(widget.written).to.deep.equal(['ready']);
        expect(widget.qaapUnrenderedOutput).to.equal('');
    });
});
