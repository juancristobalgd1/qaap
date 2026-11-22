// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapNativeHarnessAdapter } from './qaap-native-harness-adapter';

/**
 * The plain shell "harness": the user's text is the command itself. It has no prompt, model, gate or parser, so
 * every hook keeps its default. The runner still returns early for it before building any agent command.
 */
export class QaapShellHarnessAdapter extends QaapNativeHarnessAdapter {

    constructor() {
        super('shell');
    }
}
