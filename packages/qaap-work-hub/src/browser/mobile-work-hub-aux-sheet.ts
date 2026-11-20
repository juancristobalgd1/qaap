// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { createMobileSheetGrabber, installMobileSheetDragDismiss } from '@theia/qaap-mobile-shell/lib/browser/mobile-sheet-gestures';
import { isWorkHubTheiaDialogOpen } from '../common/qaap-work-hub-dialog-utils';
import {
    createQaapWorkHubPinnedPullRequestTarget,
    type QaapWorkHubPullRequestRef,
    type QaapWorkHubPullRequestTarget,
} from './qaap-work-hub-aux-pull-request-model';
import { QaapWorkHubAuxPullRequestView } from './qaap-work-hub-aux-pull-request-view';
import { QAAP_WORK_HUB_NO_SIDE_CHAT_HOST, QaapWorkHubAuxSideChatView, type QaapWorkHubAuxSideChatHost } from './qaap-work-hub-aux-side-chat-view';

/** The views the mobile sheet offers: the same two the desktop right panel has. */
export type MobileWorkHubAuxSheetTab = 'side-chat' | 'pull-request';

/** What the sheet needs from the Work Hub: the same hooks the desktop panel gets. */
export interface MobileWorkHubAuxSheetHost {
    /** The pull request of the open conversation's branch, or `undefined` while no project is open. */
    resolvePullRequestTarget(): QaapWorkHubPullRequestTarget | undefined;
    /** Opens a web page in a new tab. */
    openExternal(url: string): void;
    /** The side chat's Work Hub hooks. */
    readonly sideChat?: QaapWorkHubAuxSideChatHost;
}

export interface MobileWorkHubAuxSheetOptions {
    readonly host: MobileWorkHubAuxSheetHost;
    /** Injected for tests; by default the same view classes the desktop panel uses. */
    readonly pullRequestView?: QaapWorkHubAuxPullRequestView;
    readonly sideChatView?: QaapWorkHubAuxSideChatView;
}

export interface MobileWorkHubAuxSheetTabSpec {
    readonly id: MobileWorkHubAuxSheetTab;
    readonly label: () => string;
    readonly icon: string;
}

/** Shared tab definitions for both the mobile bottom sheet and the header views dropdown. */
export const MOBILE_WORK_HUB_AUX_SHEET_TABS: readonly MobileWorkHubAuxSheetTabSpec[] = [
    { id: 'side-chat', label: () => nls.localize('qaap/workHubAuxPanel/sideChat', 'Side chat'), icon: 'codicon-comment-discussion' },
    { id: 'pull-request', label: () => nls.localize('qaap/workHubAuxPanel/pullRequest', 'Pull request'), icon: 'codicon-git-pull-request' },
];

/**
 * The mobile twin of the desktop Work Hub right panel: a near full-screen bottom sheet with a "Side chat" and a
 * "Pull request" tab. It hosts the very same views the desktop panel does (no copies), follows the visual
 * viewport so the side chat composer stays above the keyboard, and closes with the grabber drag, the close
 * button, a backdrop tap or Escape.
 */
export class MobileWorkHubAuxSheet implements Disposable {
    readonly node: HTMLElement;
    readonly pullRequestView: QaapWorkHubAuxPullRequestView;
    readonly sideChatView: QaapWorkHubAuxSideChatView;

    protected readonly sheet: HTMLElement;
    protected readonly grabber: HTMLElement;
    protected readonly tabButtons = new Map<MobileWorkHubAuxSheetTab, HTMLButtonElement>();
    protected readonly closeButton: HTMLButtonElement;
    protected readonly toDispose = new DisposableCollection();
    protected visible = false;
    protected active: MobileWorkHubAuxSheetTab = 'side-chat';
    protected pinnedPullRequest: QaapWorkHubPullRequestRef | undefined;
    protected returnFocus: HTMLElement | undefined;
    protected dragDispose: Disposable = Disposable.NULL;
    protected viewportDispose: Disposable = Disposable.NULL;

    protected readonly onKeyDown = (event: KeyboardEvent): void => {
        if (!this.visible) {
            return;
        }
        if (event.key === 'Escape') {
            if (isWorkHubTheiaDialogOpen() || document.querySelector('.qaap-work-hub-aux-side-chat-picker:not([hidden]), .qaap-work-hub-aux-side-chat-picker:not([aria-hidden="true"])')) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.close();
        } else if (event.key === 'Tab') {
            this.trapFocus(event);
        }
    };

    constructor(protected readonly options: MobileWorkHubAuxSheetOptions) {
        const host = options.host;
        this.pullRequestView = options.pullRequestView ?? new QaapWorkHubAuxPullRequestView({ openExternal: url => host.openExternal(url) });
        this.sideChatView = options.sideChatView ?? new QaapWorkHubAuxSideChatView({
            host: host.sideChat ?? QAAP_WORK_HUB_NO_SIDE_CHAT_HOST,
            onTitle: () => undefined,
            // Bring back, delete and the view's own close all end the side chat: forget it and close the sheet.
            onClose: () => {
                this.sideChatView.reset();
                this.close();
            },
        });
        this.toDispose.push(this.pullRequestView);
        this.toDispose.push(this.sideChatView);

        this.node = document.createElement('div');
        this.node.className = 'theia-mobile-work-hub-aux-sheet';
        this.node.setAttribute('role', 'dialog');
        this.node.setAttribute('aria-modal', 'true');
        this.node.setAttribute('aria-label', nls.localizeByDefault('Views'));
        this.node.setAttribute('aria-hidden', 'true');
        this.node.hidden = true;

        const backdrop = document.createElement('div');
        backdrop.className = 'theia-mobile-work-hub-aux-sheet-backdrop';
        backdrop.addEventListener('click', () => this.close());

        this.sheet = document.createElement('section');
        this.sheet.className = 'theia-mobile-work-hub-aux-sheet-panel';

        const header = document.createElement('header');
        header.className = 'theia-mobile-work-hub-aux-sheet-header';
        this.grabber = createMobileSheetGrabber();
        this.grabber.classList.add('theia-mobile-work-hub-aux-sheet-grabber');

        const tabs = document.createElement('div');
        tabs.className = 'theia-mobile-work-hub-aux-sheet-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', nls.localizeByDefault('Views'));
        for (const spec of MOBILE_WORK_HUB_AUX_SHEET_TABS) {
            tabs.append(this.createTabButton(spec));
        }
        tabs.addEventListener('keydown', event => this.onTabsKeyDown(event));

        this.closeButton = document.createElement('button');
        this.closeButton.type = 'button';
        this.closeButton.className = 'theia-mobile-work-hub-aux-sheet-close codicon codicon-close';
        this.closeButton.title = nls.localize('qaap/mobileWorkHubPreferences/close', 'Close');
        this.closeButton.setAttribute('aria-label', this.closeButton.title);
        this.closeButton.addEventListener('click', () => this.close());

        header.append(tabs, this.closeButton);

        const body = document.createElement('div');
        body.className = 'theia-mobile-work-hub-aux-sheet-body';
        body.append(this.sideChatView.element, this.pullRequestView.element);

        this.sheet.append(this.grabber, header, body);
        this.node.append(backdrop, this.sheet);
    }

    get isOpen(): boolean {
        return this.visible;
    }

    get activeTab(): MobileWorkHubAuxSheetTab {
        return this.active;
    }

    /**
     * Opens the sheet on `tab`. A `pullRequest` ref shows exactly that pull request (a chip in the transcript)
     * instead of the branch's one, until "Back to the branch pull request".
     */
    open(tab: MobileWorkHubAuxSheetTab, pullRequest?: QaapWorkHubPullRequestRef): void {
        if (pullRequest) {
            this.pinnedPullRequest = pullRequest;
        } else if (tab === 'pull-request' && !this.visible) {
            this.pinnedPullRequest = undefined;
        }
        if (!this.node.isConnected) {
            document.body.append(this.node);
        }
        if (!this.visible) {
            const active = document.activeElement;
            this.returnFocus = active instanceof HTMLElement ? active : undefined;
            this.visible = true;
            this.node.hidden = false;
            this.node.setAttribute('aria-hidden', 'false');
            this.node.classList.add('theia-mod-visible');
            document.body.classList.add('theia-mobile-mod-aux-sheet-open');
            document.addEventListener('keydown', this.onKeyDown, true);
            this.dragDispose = installMobileSheetDragDismiss({
                target: this.sheet,
                grip: this.grabber,
                onDismiss: () => this.close(),
            });
            this.viewportDispose = this.trackVisualViewport();
        }
        this.select(tab);
        const button = this.tabButtons.get(tab);
        button?.focus({ preventScroll: true });
    }

    close(): void {
        if (!this.visible) {
            return;
        }
        this.visible = false;
        this.dragDispose.dispose();
        this.dragDispose = Disposable.NULL;
        this.viewportDispose.dispose();
        this.viewportDispose = Disposable.NULL;
        document.removeEventListener('keydown', this.onKeyDown, true);
        document.body.classList.remove('theia-mobile-mod-aux-sheet-open');
        this.sideChatView.hide();
        this.pullRequestView.stop();
        this.node.classList.remove('theia-mod-visible');
        this.node.hidden = true;
        this.node.setAttribute('aria-hidden', 'true');
        this.sheet.style.transform = '';
        this.sheet.style.opacity = '';
        const focus = this.returnFocus;
        this.returnFocus = undefined;
        if (focus?.isConnected) {
            focus.focus({ preventScroll: true });
        }
    }

    /** Re-reads the pull request target, e.g. after the open conversation changed under the sheet. */
    refresh(): void {
        if (this.visible) {
            this.select(this.active);
        }
    }

    dispose(): void {
        this.close();
        this.toDispose.dispose();
        this.node.remove();
    }

    protected select(tab: MobileWorkHubAuxSheetTab): void {
        this.active = tab;
        for (const [id, button] of this.tabButtons) {
            const selected = id === tab;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
            button.classList.toggle('theia-mod-active', selected);
        }
        this.node.dataset.view = tab;
        const sideChat = tab === 'side-chat';
        this.sideChatView.element.hidden = !sideChat;
        this.pullRequestView.element.hidden = sideChat;
        if (sideChat) {
            this.pullRequestView.stop();
            this.sideChatView.show();
        } else {
            this.sideChatView.hide();
            this.syncPullRequest();
        }
    }

    protected syncPullRequest(): void {
        const branchTarget = this.options.host.resolvePullRequestTarget();
        const pinned = this.pinnedPullRequest;
        this.pullRequestView.sync(
            pinned ? createQaapWorkHubPinnedPullRequestTarget(pinned) : branchTarget,
            this.visible,
            pinned && branchTarget ? () => {
                this.pinnedPullRequest = undefined;
                this.syncPullRequest();
            } : undefined,
        );
    }

    protected createTabButton(spec: MobileWorkHubAuxSheetTabSpec): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-work-hub-aux-sheet-tab';
        button.dataset.tab = spec.id;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', 'false');
        const glyph = document.createElement('span');
        glyph.className = `codicon ${spec.icon}`;
        glyph.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-work-hub-aux-sheet-tab-label';
        label.textContent = spec.label();
        button.append(glyph, label);
        button.addEventListener('click', () => this.select(spec.id));
        this.tabButtons.set(spec.id, button);
        return button;
    }

    protected onTabsKeyDown(event: KeyboardEvent): void {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
            return;
        }
        const index = MOBILE_WORK_HUB_AUX_SHEET_TABS.findIndex(spec => spec.id === this.active);
        const next = MOBILE_WORK_HUB_AUX_SHEET_TABS[
            (index + (event.key === 'ArrowRight' ? 1 : MOBILE_WORK_HUB_AUX_SHEET_TABS.length - 1)) % MOBILE_WORK_HUB_AUX_SHEET_TABS.length
        ];
        event.preventDefault();
        this.select(next.id);
        this.tabButtons.get(next.id)?.focus({ preventScroll: true });
    }

    /** Keeps Tab inside the modal sheet. */
    protected trapFocus(event: KeyboardEvent): void {
        const focusable = Array.from(this.sheet.querySelectorAll<HTMLElement>(
            'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        )).filter(element => !element.hidden && !element.closest('[hidden]') && !(element as HTMLButtonElement).disabled);
        if (!focusable.length) {
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const current = document.activeElement;
        if (!this.sheet.contains(current)) {
            event.preventDefault();
            first.focus();
        } else if (event.shiftKey && current === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && current === last) {
            event.preventDefault();
            first.focus();
        }
    }

    /**
     * Fits the sheet to the visual viewport: with the on-screen keyboard open its height and offset shrink to the
     * visible band, so the side chat composer at the bottom sits right above the keyboard.
     */
    protected trackVisualViewport(): Disposable {
        const viewport = typeof window !== 'undefined' ? window.visualViewport : undefined;
        if (!viewport) {
            return Disposable.NULL;
        }
        const apply = (): void => {
            this.node.style.setProperty('--theia-mobile-aux-sheet-vv-height', `${Math.round(viewport.height)}px`);
            this.node.style.setProperty('--theia-mobile-aux-sheet-vv-top', `${Math.round(viewport.offsetTop)}px`);
            const occluded = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
            this.node.classList.toggle('theia-mod-keyboard-open', occluded > 80);
        };
        apply();
        viewport.addEventListener('resize', apply);
        viewport.addEventListener('scroll', apply);
        return Disposable.create(() => {
            viewport.removeEventListener('resize', apply);
            viewport.removeEventListener('scroll', apply);
            this.node.style.removeProperty('--theia-mobile-aux-sheet-vv-height');
            this.node.style.removeProperty('--theia-mobile-aux-sheet-vv-top');
            this.node.classList.remove('theia-mod-keyboard-open');
        });
    }
}
