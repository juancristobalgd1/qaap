// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { QaapAgentPreviewChromeStyle as Style } from './qaap-agent-preview-chrome-style';
import {
    createQaapPreviewOpenExternalButton,
    createQaapPreviewToolbarIconButton,
} from './qaap-agent-preview-chrome';
import { createPreviewEditButton } from './qaap-preview-edit-menu';
import {
    createPreviewMaximizeButton,
    QaapPreviewMaximizeController,
} from './qaap-preview-maximize';

/** Marks the disabled starting-preview copy of the embedded preview toolbar. */
export const QAAP_PREVIEW_TOOLBAR_SKELETON_CLASS = 'qaap-mod-preview-toolbar-skeleton';

export interface QaapPreviewToolbarSkeletonOptions {
    /** URL field placeholder shown while the preview has no page yet, e.g. "Starting preview…". */
    readonly placeholder: string;
}

/**
 * Disabled copy of the embedded preview toolbar, shown while the preview has no mounted page.
 * It is built from the same factories as the real chrome (`mountEmbeddedAgentPreviewChrome`) in
 * its default state, so the markup, classes, icons and order match exactly; only the disabled
 * state differs. Every control is disabled and the root is `aria-busy`.
 */
export function createQaapPreviewToolbarSkeleton(options: QaapPreviewToolbarSkeletonOptions): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = [
        'qaap-agent-preview-embedded-toolbar',
        'theia-mini-browser-toolbar',
        'theia-mobile-execution-surface-sidebar-toolbar',
        QAAP_PREVIEW_TOOLBAR_SKELETON_CLASS,
        'qaap-mod-frame-loading',
    ].join(' ');
    toolbar.setAttribute('aria-busy', 'true');

    const backLabel = nls.localize('qaap/preview/showPreviousPage', 'Show the previous page');
    const back = createQaapPreviewToolbarIconButton(backLabel, 'arrow-left', Style.TOOLBAR_BACK);
    back.setAttribute('aria-label', backLabel);

    const forwardLabel = nls.localize('qaap/preview/showNextPage', 'Show the next page');
    const forward = createQaapPreviewToolbarIconButton(forwardLabel, 'arrow-right', Style.TOOLBAR_FORWARD);
    forward.setAttribute('aria-label', forwardLabel);

    const urlField = document.createElement('div');
    urlField.className = 'theia-mini-browser-url-field';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'theia-input';
    input.spellcheck = false;
    input.readOnly = true;
    input.placeholder = options.placeholder;
    const openButton = createQaapPreviewOpenExternalButton(
        nls.localize('theia/mini-browser/openInNewBrowserTab', 'Open in New Browser Tab'),
    );
    urlField.append(input, openButton);

    // The skeleton never reacts to clicks (disabled), so the handlers are inert and the
    // collection is dropped with the skeleton.
    const maximize = createPreviewMaximizeButton(new QaapPreviewMaximizeController(() => toolbar));
    const edit = createPreviewEditButton({
        onSelectSelection: () => undefined,
        onSelectAnnotate: () => undefined,
        toDispose: new DisposableCollection(),
    });
    const workbench = document.createElement('div');
    workbench.className = 'theia-mini-browser-workbench-controls';
    workbench.append(maximize, edit);

    const overflow = createQaapPreviewToolbarIconButton(
        nls.localize('qaap/preview/moreActions', 'More preview actions'),
        'kebab-vertical',
        Style.TOOLBAR_OVERFLOW,
    );

    // Same order as the real toolbar: Back, Forward, URL field, Maximize + Edit, overflow.
    const controls: HTMLButtonElement[] = [back, forward, openButton, maximize, edit, overflow];
    for (const control of controls) {
        control.disabled = true;
    }
    input.disabled = true;
    toolbar.append(back, forward, urlField, workbench, overflow);
    return toolbar;
}
