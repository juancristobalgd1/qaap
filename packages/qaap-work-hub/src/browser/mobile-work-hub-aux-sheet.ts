// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
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

/** Shared view definitions for the mobile drawer and the header views dropdown. */
export const MOBILE_WORK_HUB_AUX_SHEET_TABS: readonly MobileWorkHubAuxSheetTabSpec[] = [
    { id: 'side-chat', label: () => nls.localize('qaap/workHubAuxPanel/sideChat', 'Side chat'), icon: 'codicon-comment-discussion' },
    { id: 'pull-request', label: () => nls.localize('qaap/workHubAuxPanel/pullRequest', 'Pull request'), icon: 'codicon-git-pull-request' },
];

/** Matches the execution surface drawer's slide-out (`transition: transform 220ms`). */
const AUX_SHEET_CLOSE_MS = 220;

/**
 * The mobile twin of the desktop Work Hub right panel. It opens "Side chat" or "Pull request" in the SAME drawer the
 * other views use (Browser, Changes, Files, Terminal): the `theia-mobile-execution-surface-sidebar` structure and
 * styles, full screen from the right, a header with the view's icon and title and a ✕, and the view below. It hosts
 * the very same view instances as the desktop panel, follows the visual viewport so the side chat composer stays
 * above the keyboard, and closes with the ✕, a backdrop tap or Escape.
 */
export class MobileWorkHubAuxSheet implements Disposable {
    readonly node: HTMLElement;
    readonly pullRequestView: QaapWorkHubAuxPullRequestView;
    readonly sideChatView: QaapWorkHubAuxSideChatView;

    protected readonly backdrop: HTMLButtonElement;
    protected readonly sheet: HTMLElement;
    protected readonly titleIcon: HTMLElement;
    protected readonly title: HTMLElement;
    protected readonly closeButton: HTMLButtonElement;
    protected readonly toDispose = new DisposableCollection();
    protected visible = false;
    protected active: MobileWorkHubAuxSheetTab = 'side-chat';
    protected pinnedPullRequest: QaapWorkHubPullRequestRef | undefined;
    protected returnFocus: HTMLElement | undefined;
    protected viewportDispose: Disposable = Disposable.NULL;
    protected closeTimer: ReturnType<typeof setTimeout> | undefined;

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

        const closeLabel = nls.localize('qaap/mobileProjects/closeExecutionSurface', 'Close view');

        this.node = document.createElement('div');
        this.node.className = 'theia-mobile-work-hub-aux-sheet';
        this.node.hidden = true;

        this.backdrop = document.createElement('button');
        this.backdrop.type = 'button';
        this.backdrop.className = 'theia-mobile-execution-surface-sidebar-backdrop theia-mobile-work-hub-aux-sheet-backdrop';
        this.backdrop.setAttribute('aria-label', closeLabel);
        this.backdrop.title = closeLabel;
        this.backdrop.tabIndex = -1;
        this.backdrop.addEventListener('click', () => this.close());

        this.sheet = document.createElement('section');
        this.sheet.className = 'theia-mobile-execution-surface-sidebar theia-mobile-work-hub-aux-sheet-panel';
        this.sheet.setAttribute('role', 'dialog');
        this.sheet.setAttribute('aria-modal', 'true');

        const header = document.createElement('header');
        header.className = 'theia-mobile-execution-surface-sidebar-header theia-mobile-work-hub-aux-sheet-header';
        this.titleIcon = document.createElement('span');
        this.titleIcon.setAttribute('aria-hidden', 'true');
        this.title = document.createElement('h2');
        this.title.className = 'theia-mobile-execution-surface-sidebar-title';
        this.title.id = `qaap-mobile-aux-sheet-title-${Date.now().toString(36)}`;
        this.sheet.setAttribute('aria-labelledby', this.title.id);
        const divider = document.createElement('span');
        divider.className = 'theia-mobile-execution-surface-sidebar-header-divider';
        divider.setAttribute('aria-hidden', 'true');
        this.closeButton = document.createElement('button');
        this.closeButton.type = 'button';
        this.closeButton.className = 'theia-mobile-execution-surface-sidebar-close theia-mobile-work-hub-aux-sheet-close codicon codicon-close';
        this.closeButton.title = closeLabel;
        this.closeButton.setAttribute('aria-label', closeLabel);
        this.closeButton.addEventListener('click', () => this.close());
        header.append(this.titleIcon, this.title, divider, this.closeButton);

        const body = document.createElement('div');
        body.className = 'theia-mobile-execution-surface-sidebar-content theia-mobile-work-hub-aux-sheet-body';
        body.append(this.sideChatView.element, this.pullRequestView.element);

        this.sheet.append(header, body);
        this.node.append(this.backdrop, this.sheet);
    }

    get isOpen(): boolean {
        return this.visible;
    }

    get activeTab(): MobileWorkHubAuxSheetTab {
        return this.active;
    }

    /**
     * Opens the drawer on `tab`. A `pullRequest` ref shows exactly that pull request (a chip in the transcript)
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
        if (this.closeTimer !== undefined) {
            clearTimeout(this.closeTimer);
            this.closeTimer = undefined;
        }
        if (!this.visible) {
            const active = document.activeElement;
            this.returnFocus = active instanceof HTMLElement ? active : undefined;
            this.visible = true;
            this.node.hidden = false;
            this.sheet.classList.remove('theia-mod-closing');
            this.backdrop.classList.remove('theia-mod-closing');
            document.body.classList.add('theia-mobile-mod-aux-sheet-open');
            document.addEventListener('keydown', this.onKeyDown, true);
            this.viewportDispose = this.trackVisualViewport();
            // Next frame, like the other views' drawer: the slide-in transition needs the closed state painted first.
            const reveal = (): void => {
                if (this.visible) {
                    this.backdrop.classList.add('theia-mod-open');
                    this.sheet.classList.add('theia-mod-open');
                }
            };
            if (typeof window.requestAnimationFrame === 'function') {
                window.requestAnimationFrame(reveal);
            } else {
                setTimeout(reveal, 0);
            }
        }
        this.select(tab);
        this.closeButton.focus({ preventScroll: true });
    }

    close(): void {
        if (!this.visible) {
            return;
        }
        this.visible = false;
        this.viewportDispose.dispose();
        this.viewportDispose = Disposable.NULL;
        document.removeEventListener('keydown', this.onKeyDown, true);
        document.body.classList.remove('theia-mobile-mod-aux-sheet-open');
        this.sideChatView.hide();
        this.pullRequestView.stop();
        this.backdrop.classList.remove('theia-mod-open');
        this.sheet.classList.remove('theia-mod-open');
        this.backdrop.classList.add('theia-mod-closing');
        this.sheet.classList.add('theia-mod-closing');
        this.closeTimer = setTimeout(() => {
            this.closeTimer = undefined;
            if (!this.visible) {
                this.node.hidden = true;
            }
        }, AUX_SHEET_CLOSE_MS);
        const focus = this.returnFocus;
        this.returnFocus = undefined;
        if (focus?.isConnected) {
            focus.focus({ preventScroll: true });
        }
    }

    /** Re-reads the pull request target, e.g. after the open conversation changed under the drawer. */
    refresh(): void {
        if (this.visible) {
            this.select(this.active);
        }
    }

    dispose(): void {
        this.close();
        if (this.closeTimer !== undefined) {
            clearTimeout(this.closeTimer);
            this.closeTimer = undefined;
        }
        this.toDispose.dispose();
        this.node.remove();
    }

    protected select(tab: MobileWorkHubAuxSheetTab): void {
        this.active = tab;
        const spec = MOBILE_WORK_HUB_AUX_SHEET_TABS.find(candidate => candidate.id === tab) ?? MOBILE_WORK_HUB_AUX_SHEET_TABS[0];
        this.titleIcon.className = `theia-mobile-execution-surface-sidebar-icon codicon ${spec.icon}`;
        this.title.textContent = spec.label();
        this.sheet.dataset.surface = tab;
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

    /** Keeps Tab inside the modal drawer. */
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
     * Fits the drawer to the visual viewport: with the on-screen keyboard open its height and offset shrink to the
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
