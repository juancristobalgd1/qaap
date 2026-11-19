// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { TerminalWidgetImpl } from '@theia/terminal/lib/browser/terminal-widget-impl';
import { QAAP_PREVIEW_TERMINAL_KIND } from './qaap-preview-terminal-lifecycle';
import { QaapUnrenderedOutputTerminal } from './qaap-terminal-unrendered-output';

/** Terminal kinds whose output must be observable even while the widget was never opened. */
const QAAP_HIDDEN_OUTPUT_TERMINAL_KINDS: ReadonlySet<string> = new Set([QAAP_PREVIEW_TERMINAL_KIND]);

/**
 * Upstream `TerminalWidgetImpl.write` keeps everything that arrives before the widget is opened in a
 * private `initialData` string and fires neither `onOutput` nor fills the xterm buffer. Work Hub
 * spawns its preview dev servers hidden (`reveal: false`), so their output was invisible: a fast exit
 * (`sh: vite: command not found`, `Port 5173 is already in use`) reached the user as a bare
 * "Dev server exited with code 1." and neither the automatic install nor the port recovery, which
 * both read that output, could run.
 *
 * For Qaap-managed hidden terminals this fires `onOutput` for unopened writes too (opening the widget
 * later replays `initialData` straight into xterm, so nothing is reported twice) and exposes the
 * buffered text through {@link qaapUnrenderedOutput}.
 */
@injectable()
export class QaapTerminalWidget extends TerminalWidgetImpl implements QaapUnrenderedOutputTerminal {

    override write(data: string): void {
        const opened = this.termOpened;
        super.write(data);
        if (!opened && data && QAAP_HIDDEN_OUTPUT_TERMINAL_KINDS.has(this.kind)) {
            this.onOutputEmitter.fire(data);
        }
    }

    /** Raw output received while the widget was never opened (`''` once it is opened). */
    get qaapUnrenderedOutput(): string {
        return this.termOpened ? '' : this.initialData;
    }
}
