// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * A terminal that exposes the output it received before its widget was opened (see
 * `QaapTerminalWidget`). Kept apart from the widget so pure helpers can test for it without loading xterm.
 */
export interface QaapUnrenderedOutputTerminal {
    readonly qaapUnrenderedOutput: string;
}

export function hasQaapUnrenderedOutput(terminal: object): terminal is QaapUnrenderedOutputTerminal {
    return typeof (terminal as Partial<QaapUnrenderedOutputTerminal>).qaapUnrenderedOutput === 'string';
}
