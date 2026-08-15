// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import URI from '@theia/core/lib/common/uri';
import { injectable } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';

/**
 * Hidden {@link AIChatInputWidget} owned by {@link QaapWorkHubChatViewWidget}.
 *
 * Work Hub replaces the upstream chat body with the sticky composer, but
 * {@link ChatViewWidget} still constructs an input widget in DI. The vanilla
 * widget registers the singleton in-memory URI `ai-chat:/input.aichatviewlanguage`,
 * which races with Monaco model resolve / later project-card inputs and surfaces
 * as "Cannot add already existing in-memory resource".
 *
 * This subclass mints a unique URI and renders nothing — the sticky composer is
 * the real input surface.
 */
@injectable()
export class WorkHubShellAIChatInputWidget extends AIChatInputWidget {

    private static instanceCounter = 0;
    private readonly shellInstanceSeq = ++WorkHubShellAIChatInputWidget.instanceCounter;

    protected override getResourceUri(): URI {
        return new URI(`ai-chat:/work-hub-shell-input-${this.shellInstanceSeq}.aichatviewlanguage`);
    }

    protected override render(): React.ReactNode {
        return null;
    }
}
