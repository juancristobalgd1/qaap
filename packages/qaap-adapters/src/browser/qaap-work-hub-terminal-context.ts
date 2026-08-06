// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';

export interface QaapWorkHubTerminalContext {
    createNewTerminal(): Promise<void>;
    closeTerminal(): Promise<void>;
    askAi(question: string): Promise<void>;
}

const contexts = new WeakMap<object, QaapWorkHubTerminalContext>();

/** Registers the Work Hub actions associated with an embedded terminal. */
export function registerQaapWorkHubTerminalContext(
    terminal: object,
    context: QaapWorkHubTerminalContext,
): Disposable {
    contexts.set(terminal, context);
    const closeAwareTerminal = terminal as {
        onTerminalDidClose?: (listener: () => void) => Disposable;
    };
    const onTerminalDidClose = closeAwareTerminal.onTerminalDidClose?.(() => {
        if (contexts.get(terminal) === context) {
            contexts.delete(terminal);
        }
    });
    return Disposable.create(() => {
        onTerminalDidClose?.dispose();
        if (contexts.get(terminal) === context) {
            contexts.delete(terminal);
        }
    });
}

export function getQaapWorkHubTerminalContext(terminal: object): QaapWorkHubTerminalContext | undefined {
    return contexts.get(terminal);
}
