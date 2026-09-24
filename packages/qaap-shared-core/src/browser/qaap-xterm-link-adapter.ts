// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, interfaces } from '@theia/core/shared/inversify';
import { ILink } from 'xterm';
import {
    LinkContext
} from '@theia/terminal/lib/browser/terminal-link-helpers';
import {
    TerminalLink,
    XtermLink,
    XtermLinkAdapter,
    XtermLinkFactory
} from '@theia/terminal/lib/browser/terminal-link-provider';
import { TerminalWidgetImpl } from '@theia/terminal/lib/browser/terminal-widget-impl';
import {
    shouldActivateTerminalLink,
    touchEndInfo,
    wasRecentTap
} from './qaap-terminal-link-activation';

/**
 * Drift seam for `packages/terminal` (an upstream Theia package that CI forbids
 * editing). Subclasses {@link XtermLinkAdapter} to make terminal link taps
 * reliable on touch devices while keeping the desktop Cmd/Ctrl+click behaviour
 * (which protects text selection).
 *
 * Wired in via {@link createQaapXtermLinkFactory}, rebound onto the upstream
 * {@link XtermLinkFactory} in `qaap-mobile-shell-frontend-module.ts`.
 *
 * The activation decision lives in the pure, unit-tested
 * `qaap-terminal-link-activation.ts` module.
 */
@injectable()
export class QaapXtermLinkAdapter extends XtermLinkAdapter {

    override activate(event: MouseEvent, _text: string): void {
        event.preventDefault();
        if (this.shouldActivateLink(event)) {
            this.executeLinkHandler();
        } else {
            this.terminalWidget.getTerminal().focus();
        }
    }

    protected shouldActivateLink(event: MouseEvent): boolean {
        return shouldActivateTerminalLink({
            modifierKeyDown: this.isModifierKeyDown(event),
            touchPrimaryDevice: this.isTouchPrimaryDevice(),
            recentTouch: this.wasRecentTap(event)
        });
    }

    /**
     * `true` on phones/tablets, where the primary pointer is coarse and there
     * is no hover. On such devices every link activation is a tap, so we open
     * the link without depending on matching a synthetic click — this is the
     * robust mobile-first path.
     */
    protected isTouchPrimaryDevice(): boolean {
        const view = typeof window !== 'undefined' ? window : undefined;
        if (!view || typeof view.matchMedia !== 'function') {
            return false;
        }
        try {
            return view.matchMedia('(pointer: coarse)').matches
                || view.matchMedia('(hover: none)').matches;
        } catch {
            return false;
        }
    }

    /** `true` when this click was produced by a recent tap (hybrid devices). */
    protected wasRecentTap(event: MouseEvent): boolean {
        const lastTouchEnd = this.terminalWidget.lastTouchEndEvent;
        return wasRecentTap(
            { timeStamp: event.timeStamp, pageX: event.pageX, pageY: event.pageY },
            lastTouchEnd ? touchEndInfo(lastTouchEnd) : undefined
        );
    }
}

/**
 * Replacement for the upstream `createXtermLinkFactory` that instantiates a
 * {@link QaapXtermLinkAdapter} instead of the stock `XtermLinkAdapter`. Bound
 * with `rebind(XtermLinkFactory).toFactory(createQaapXtermLinkFactory)`.
 */
export function createQaapXtermLinkFactory(ctx: interfaces.Context): XtermLinkFactory {
    return (link: TerminalLink, terminal: TerminalWidgetImpl, context: LinkContext): ILink => {
        const container = ctx.container.createChild();
        container.bind(TerminalLink).toConstantValue(link);
        container.bind(TerminalWidgetImpl).toConstantValue(terminal);
        container.bind(LinkContext).toConstantValue(context);
        container.bind(QaapXtermLinkAdapter).toSelf().inSingletonScope();
        container.bind(XtermLink).toService(QaapXtermLinkAdapter);
        return container.get<ILink>(XtermLink);
    };
}
