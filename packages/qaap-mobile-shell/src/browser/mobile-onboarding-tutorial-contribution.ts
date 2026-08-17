// *****************************************************************************
// Copyright (C) 2026 theia-ide and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { MobileHaptics } from './mobile-haptics';
import { peekPreferDesktopIde, QAAP_MOBILE_DESKTOP_IDE_BODY_CLASS } from '../common/qaap-mobile-work-surface-preference';
import {
    hasAnyAgentConversationWork,
    hasBlockingAgentConversationWork,
    isMobileOnboardingSessionSkipped,
    markMobileOnboardingSessionSkipped,
    MobileOnboardingSurface,
    shouldDeferMobileOnboardingTutorial,
} from '../common/mobile-onboarding-tutorial-guard';

// Breakpoint matches `mobile-workbench.css` and {@link MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY} in core.

type StepPlacement = 'top' | 'bottom' | 'center';
type StepDemo = 'swipe-right' | 'tap';

interface TutorialStep {
    id: string;
    title: string;
    body: string;
    /** Resolver for the element to highlight; absent steps render centered (no spotlight). */
    target?: () => HTMLElement | undefined;
    /** Optional animated demo overlay (swipe gesture, tap pulse, …). */
    demo?: StepDemo;
    /** Where to anchor the tooltip relative to the spotlight (or viewport when `center`). */
    placement: StepPlacement;
}

/** Resolve the first VISIBLE element for a selector (several surfaces clone e.g. the avatar button). */
function visibleElement(selector: string): HTMLElement | undefined {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            return el;
        }
    }
    return undefined;
}

/**
 * First-launch in-app tutorial for the mobile (≤ 767 px) layout.
 *
 * Two surface-specific tours, each with its own persistent "seen" flag:
 *   - **Work Hub / Agents** (the default surface): composer, sessions sidebar,
 *     transcript view lenses, and the IDE switch in the avatar menu.
 *   - **Classic IDE** (after "Open IDE"): the ▷ view picker, the avatar account
 *     menu, and the editor tab bar.
 *
 * The overlay never blocks pointer events on the underlying workbench: the dim backdrop and
 * spotlight ring use `pointer-events: none`, so users can complete the gesture they are being
 * taught and the tutorial will advance organically on Next or via the gesture itself.
 *
 * Anti-flicker contract: blocking checks (streaming agent work, visible turn failures) only
 * gate the tour BEFORE it opens. Once open, the tour is closed exclusively by the user
 * (Skip / Done / Escape), by leaving the mobile viewport, or by switching surface — never by a
 * background poller. A previous design re-checked "blocking work" on a 2 s interval plus a
 * whole-body MutationObserver and auto-dismissed/re-opened the tour, which flashed constantly
 * for any workspace with long-lived failed conversations.
 *
 * Persistence: `theia.mobile.tutorial.seen` (Work Hub, legacy key) and
 * `theia.mobile.tutorial.ide.seen` once the user finishes or dismisses the respective tour.
 * A dedicated `Help: Replay Mobile Tutorial` command replays the tour for the current surface.
 */
@injectable()
export class MobileOnboardingTutorialContribution implements FrontendApplicationContribution, CommandContribution {

    /** Work Hub tour flag — keeps the pre-split key so existing users are not re-prompted. */
    static readonly STORAGE_KEY = 'theia.mobile.tutorial.seen';
    static readonly IDE_STORAGE_KEY = 'theia.mobile.tutorial.ide.seen';

    static readonly REPLAY_COMMAND: Command = Command.toLocalizedCommand({
        id: 'theia.mobile.onboarding.replay',
        category: 'Help',
        label: 'Replay Mobile Tutorial',
    }, 'theia/core/mobile/replayTutorial', 'theia/core/common/help');

    @inject(StorageService)
    protected readonly storage: StorageService;

    protected readonly toDispose = new DisposableCollection();
    protected readonly mobileMq: MediaQueryList | undefined =
        typeof window !== 'undefined' ? window.matchMedia(MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY) : undefined;

    protected overlay: HTMLElement | undefined;
    protected backdrop: HTMLElement | undefined;
    protected spotlight: HTMLElement | undefined;
    protected tooltip: HTMLElement | undefined;
    protected demoLayer: HTMLElement | undefined;
    protected currentIndex = 0;
    protected steps: TutorialStep[] = [];
    protected reflowRaf = 0;
    protected active = false;
    /** Surface the currently open tour belongs to. */
    protected activeSurface: MobileOnboardingSurface = 'work-hub';
    protected deferTimer: number | undefined;
    protected activeAgentWatchTimer: number | undefined;
    protected surfaceObserver: MutationObserver | undefined;
    protected lastKnownSurface: MobileOnboardingSurface = 'work-hub';

    onDidInitializeLayout(_app: FrontendApplication): void {
        this.mobileMq?.addEventListener('change', this.onMediaChange);
        this.lastKnownSurface = this.currentSurface();
        this.startSurfaceWatch();
        if (this.mobileMq?.matches) {
            void this.maybeStartFirstRun();
        }
    }

    onStop(): void {
        this.mobileMq?.removeEventListener('change', this.onMediaChange);
        this.stopSurfaceWatch();
        this.stopDeferLoop();
        this.dismiss(false);
        this.toDispose.dispose();
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(MobileOnboardingTutorialContribution.REPLAY_COMMAND, {
            execute: () => this.start(true),
            isEnabled: () => !!this.mobileMq?.matches,
            isVisible: () => !!this.mobileMq?.matches,
        });
    }

    protected currentSurface(): MobileOnboardingSurface {
        return peekPreferDesktopIde() ? 'ide' : 'work-hub';
    }

    protected seenKeyFor(surface: MobileOnboardingSurface): string {
        return surface === 'ide'
            ? MobileOnboardingTutorialContribution.IDE_STORAGE_KEY
            : MobileOnboardingTutorialContribution.STORAGE_KEY;
    }

    protected readonly onMediaChange = (): void => {
        // Leaving mobile mode while the tutorial is open would leave dangling absolutely-positioned
        // overlays on top of the desktop shell. Dismiss without marking as "seen" so a return to
        // narrow viewport re-prompts on next launch.
        if (!this.mobileMq?.matches) {
            this.dismiss(false);
        }
    };

    /**
     * Watch the desktop-IDE body class so each surface gets ITS tour: entering the IDE the first
     * time starts the IDE tour, and a tour left open across a surface switch is closed (unseen)
     * instead of narrating the wrong surface. Observes `document.body` class only — no subtree.
     */
    protected startSurfaceWatch(): void {
        if (this.surfaceObserver || typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
            return;
        }
        this.surfaceObserver = new MutationObserver(() => this.onPossibleSurfaceChange());
        this.surfaceObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    protected stopSurfaceWatch(): void {
        this.surfaceObserver?.disconnect();
        this.surfaceObserver = undefined;
    }

    protected onPossibleSurfaceChange(): void {
        const surface: MobileOnboardingSurface =
            document.body.classList.contains(QAAP_MOBILE_DESKTOP_IDE_BODY_CLASS) ? 'ide' : 'work-hub';
        if (surface === this.lastKnownSurface) {
            return;
        }
        this.lastKnownSurface = surface;
        if (this.active && this.activeSurface !== surface) {
            this.dismiss(false);
        }
        if (this.mobileMq?.matches) {
            void this.maybeStartFirstRun();
        }
    }

    protected async maybeStartFirstRun(): Promise<void> {
        const surface = this.currentSurface();
        const seen = await this.storage.getData<boolean>(this.seenKeyFor(surface), false);
        if (seen || !this.mobileMq?.matches || isMobileOnboardingSessionSkipped(surface)) {
            return;
        }
        // Product onboarding: don't show coach-marks to a user who already has agent
        // conversation history — they are not new.
        if (await hasAnyAgentConversationWork()) {
            return;
        }
        this.scheduleFirstRunWhenIdle(surface);
    }

    /**
     * Retry loop that opens the tour once the surface is idle (no streaming agent work, no visible
     * turn failure). Gating happens ONLY here, before opening — never against an open tour.
     */
    protected scheduleFirstRunWhenIdle(surface: MobileOnboardingSurface): void {
        if (this.active || this.deferTimer !== undefined) {
            return;
        }
        const attempt = (): void => {
            void (async (): Promise<void> => {
                this.deferTimer = undefined;
                if (!this.mobileMq?.matches
                    || this.active
                    || this.currentSurface() !== surface
                    || isMobileOnboardingSessionSkipped(surface)) {
                    return;
                }
                const blocking = shouldDeferMobileOnboardingTutorial()
                    || await hasBlockingAgentConversationWork();
                if (blocking) {
                    this.deferTimer = window.setTimeout(attempt, 2000);
                    return;
                }
                requestAnimationFrame(() => this.openTutorial());
            })();
        };
        this.deferTimer = window.setTimeout(attempt, 0);
    }

    protected stopDeferLoop(): void {
        if (this.deferTimer !== undefined) {
            window.clearTimeout(this.deferTimer);
            this.deferTimer = undefined;
        }
    }

    /**
     * Open the tutorial overlay.
     *
     * @param replay when `true`, skip the "seen"/blocking checks – used by the replay command.
     */
    protected start(replay: boolean): void {
        if (typeof document === 'undefined' || !this.mobileMq?.matches) {
            return;
        }
        if (replay) {
            this.openTutorial();
            return;
        }
        void this.maybeStartFirstRun();
    }

    protected openTutorial(): void {
        if (typeof document === 'undefined' || !this.mobileMq?.matches) {
            return;
        }
        if (this.active) {
            // Reset to first step on explicit replay.
            this.currentIndex = 0;
            this.renderCurrentStep();
            return;
        }
        this.stopDeferLoop();
        this.active = true;
        this.activeSurface = this.currentSurface();
        this.steps = this.buildSteps(this.activeSurface);
        this.currentIndex = 0;
        this.ensureOverlayElements();
        this.renderCurrentStep();
        this.startActiveAgentWatch();
        window.addEventListener('resize', this.scheduleReflow, { passive: true });
        window.addEventListener('orientationchange', this.scheduleReflow, { passive: true });
        document.addEventListener('keydown', this.onKeyDown);
    }

    /**
     * While the tutorial is open, dismiss it — terminally (marked seen, no re-open) — as soon as
     * active agent work appears, so the coach-marks never sit on top of the agent surface
     * (regression guard QA-006). This does NOT reintroduce the old flashing: the dismiss is
     * terminal (seen = true stops any re-open), and `failed` conversations no longer count as
     * blocking, so a workspace full of old failed sessions stays perfectly stable.
     */
    protected startActiveAgentWatch(): void {
        if (this.activeAgentWatchTimer !== undefined || typeof window === 'undefined') {
            return;
        }
        const tick = (): void => {
            if (!this.active) {
                return;
            }
            if (shouldDeferMobileOnboardingTutorial()) {
                this.dismiss(true);
                return;
            }
            // Any conversation existing (created via composer or API, streaming or already idle)
            // means the user is doing agent work — get the coach-marks out of the way for good.
            void hasAnyAgentConversationWork().then(exists => {
                if (exists && this.active) {
                    this.dismiss(true);
                }
            });
        };
        this.activeAgentWatchTimer = window.setInterval(tick, 400);
        tick();
    }

    protected stopActiveAgentWatch(): void {
        if (this.activeAgentWatchTimer !== undefined) {
            window.clearInterval(this.activeAgentWatchTimer);
            this.activeAgentWatchTimer = undefined;
        }
    }

    protected dismiss(markSeen: boolean): void {
        if (!this.active) {
            if (!markSeen) {
                this.stopDeferLoop();
            }
            return;
        }
        this.active = false;
        this.stopDeferLoop();
        this.stopActiveAgentWatch();
        window.removeEventListener('resize', this.scheduleReflow);
        window.removeEventListener('orientationchange', this.scheduleReflow);
        document.removeEventListener('keydown', this.onKeyDown);
        if (this.reflowRaf) {
            cancelAnimationFrame(this.reflowRaf);
            this.reflowRaf = 0;
        }
        if (this.overlay?.parentElement) {
            this.overlay.parentElement.removeChild(this.overlay);
        }
        this.overlay = undefined;
        this.backdrop = undefined;
        this.spotlight = undefined;
        this.tooltip = undefined;
        this.demoLayer = undefined;
        if (markSeen) {
            markMobileOnboardingSessionSkipped(this.activeSurface);
            this.storage.setData(this.seenKeyFor(this.activeSurface), true)
                .catch(() => { /* swallow: storage failures should not block the UI */ });
        }
    }

    /** Close for this session but keep it eligible to reappear on a fresh session (not marked seen). */
    protected remindLater(): void {
        const surface = this.activeSurface;
        markMobileOnboardingSessionSkipped(surface);
        this.dismiss(false);
    }

    protected ensureOverlayElements(): void {
        if (this.overlay) {
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'theia-mobile-onboarding-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'false');
        overlay.setAttribute(
            'aria-label',
            nls.localize('theia/core/mobile/onboarding/title', 'Mobile tutorial')
        );

        const backdrop = document.createElement('div');
        backdrop.className = 'theia-mobile-onboarding-backdrop';
        backdrop.setAttribute('aria-hidden', 'true');
        overlay.appendChild(backdrop);

        const spotlight = document.createElement('div');
        spotlight.className = 'theia-mobile-onboarding-spotlight';
        spotlight.setAttribute('aria-hidden', 'true');
        overlay.appendChild(spotlight);

        const demoLayer = document.createElement('div');
        demoLayer.className = 'theia-mobile-onboarding-demo';
        demoLayer.setAttribute('aria-hidden', 'true');
        overlay.appendChild(demoLayer);

        const tooltip = document.createElement('div');
        tooltip.className = 'theia-mobile-onboarding-tooltip';
        tooltip.setAttribute('role', 'group');
        overlay.appendChild(tooltip);

        document.body.appendChild(overlay);

        this.overlay = overlay;
        this.backdrop = backdrop;
        this.spotlight = spotlight;
        this.demoLayer = demoLayer;
        this.tooltip = tooltip;
    }

    protected buildSteps(surface: MobileOnboardingSurface): TutorialStep[] {
        return surface === 'ide' ? this.buildIdeSteps() : this.buildWorkHubSteps();
    }

    /** Tour for the Agents / Work Hub surface (the reload default). */
    protected buildWorkHubSteps(): TutorialStep[] {
        return [
            {
                id: 'wh-compose',
                title: nls.localize('qaap/mobileOnboarding/workHub/compose/title', 'Delegate your first task'),
                body: nls.localize(
                    'qaap/mobileOnboarding/workHub/compose/body',
                    'Describe the outcome in the composer below. QAIQ plans and runs it on the server — the work keeps going even if you close this tab, and you get notified when it finishes or needs you.'
                ),
                target: () => visibleElement('.theia-mobile-projects-sticky-composer'),
                placement: 'top',
            },
            {
                id: 'wh-sessions',
                title: nls.localize('qaap/mobileOnboarding/workHub/sessions/title', 'Projects & session history'),
                body: nls.localize(
                    'qaap/mobileOnboarding/workHub/sessions/body',
                    'Tap the menu to open your projects and sessions — every repo with its running and finished tasks in one place. Tap a session to reopen its transcript.'
                ),
                target: () => visibleElement('.theia-mobile-projects-sessions-menu'),
                demo: 'tap',
                placement: 'bottom',
            },
            {
                id: 'wh-views',
                title: nls.localize('qaap/mobileOnboarding/workHub/views/title', 'Follow the work, your way'),
                body: nls.localize(
                    'qaap/mobileOnboarding/workHub/views/body',
                    'While a task runs, switch lenses from the header: Chat, Plan, Changes, Preview, Files, or Terminal — every step stays visible.'
                ),
                target: () => visibleElement('.theia-mobile-transcript-tab-icon-select'),
                demo: 'tap',
                placement: 'bottom',
            },
            {
                id: 'wh-review',
                title: nls.localize('qaap/mobileOnboarding/workHub/review/title', 'Review, then commit — from your phone'),
                body: nls.localize(
                    'qaap/mobileOnboarding/workHub/review/body',
                    'When the task finishes, open Changes to read the diff. Stage or discard individual hunks, then Commit — or Create PR — right here. That is the whole loop: delegate, watch, review, ship.'
                ),
                placement: 'center',
            },
            {
                id: 'wh-ide-switch',
                title: nls.localize('qaap/mobileOnboarding/workHub/ideSwitch/title', 'Need the full editor?'),
                body: nls.localize(
                    'qaap/mobileOnboarding/workHub/ideSwitch/body',
                    'Open the avatar menu and flip the IDE | Agents switch to enter the classic IDE. Your agents keep running here in Work Hub while you edit.'
                ),
                placement: 'center',
            },
        ];
    }

    /** Tour for the classic IDE surface (after "Open IDE"). */
    protected buildIdeSteps(): TutorialStep[] {
        return [
            {
                id: 'ide-view-picker',
                title: nls.localize('qaap/mobileOnboarding/ide/viewPicker/title', 'Views at your thumb'),
                body: nls.localize(
                    'qaap/mobileOnboarding/ide/viewPicker/body',
                    'Use the ▷ selector next to the tabs to jump between Preview, Terminal, Explore, and PR.'
                ),
                target: () => visibleElement('.theia-workbench-mobile-view-picker-btn'),
                demo: 'tap',
                placement: 'bottom',
            },
            {
                id: 'ide-avatar',
                title: nls.localize('qaap/mobileOnboarding/ide/avatar/title', 'Your account menu'),
                body: nls.localize(
                    'qaap/mobileOnboarding/ide/avatar/body',
                    'The avatar opens the Command Palette, Settings, and the IDE | Agents switch back to Work Hub.'
                ),
                target: () => visibleElement('.theia-workbench-account-btn'),
                demo: 'tap',
                placement: 'bottom',
            },
            {
                id: 'ide-tabs',
                title: nls.localize('theia/core/mobile/onboarding/tabs/title', 'Scroll the tab bar'),
                body: nls.localize(
                    'theia/core/mobile/onboarding/tabs/body',
                    'With several editors open, swipe sideways on the tab titles to see every open editor, then tap one to switch.'
                ),
                target: () => visibleElement('#theia-main-content-panel .lm-TabBar.theia-app-centers'),
                placement: 'bottom',
            },
            {
                id: 'ide-agents-running',
                title: nls.localize('qaap/mobileOnboarding/ide/agentsRunning/title', 'Agents keep working'),
                body: nls.localize(
                    'qaap/mobileOnboarding/ide/agentsRunning/body',
                    'Tasks you delegated keep running on the server while you edit. Switch back to Agents from the avatar menu to check on them.'
                ),
                placement: 'center',
            },
        ];
    }

    protected readonly scheduleReflow = (): void => {
        if (this.reflowRaf) {
            return;
        }
        this.reflowRaf = requestAnimationFrame(() => {
            this.reflowRaf = 0;
            this.positionForCurrentStep();
        });
    };

    protected readonly onKeyDown = (e: KeyboardEvent): void => {
        if (!this.active) {
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            this.dismiss(true);
        } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
            e.preventDefault();
            this.next();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            this.previous();
        }
    };

    protected next(): void {
        if (this.currentIndex >= this.steps.length - 1) {
            MobileHaptics.fire(MobileHaptics.SUCCESS);
            this.dismiss(true);
            return;
        }
        this.currentIndex += 1;
        MobileHaptics.fire(MobileHaptics.LIGHT);
        this.renderCurrentStep();
    }

    protected previous(): void {
        if (this.currentIndex === 0) {
            return;
        }
        this.currentIndex -= 1;
        MobileHaptics.fire(MobileHaptics.LIGHT);
        this.renderCurrentStep();
    }

    protected renderCurrentStep(): void {
        const step = this.steps[this.currentIndex];
        if (!step || !this.tooltip) {
            return;
        }
        this.tooltip.replaceChildren(this.buildTooltipContent(step));
        this.renderDemo(step);
        this.positionForCurrentStep();
    }

    protected buildTooltipContent(step: TutorialStep): DocumentFragment {
        const fragment = document.createDocumentFragment();

        const progress = document.createElement('div');
        progress.className = 'theia-mobile-onboarding-progress';
        progress.textContent = `${this.currentIndex + 1} / ${this.steps.length}`;
        fragment.appendChild(progress);

        const title = document.createElement('h3');
        title.className = 'theia-mobile-onboarding-title';
        title.textContent = step.title;
        fragment.appendChild(title);

        const body = document.createElement('p');
        body.className = 'theia-mobile-onboarding-body';
        body.textContent = step.body;
        fragment.appendChild(body);

        const actions = document.createElement('div');
        actions.className = 'theia-mobile-onboarding-actions';

        const dismissGroup = document.createElement('div');
        dismissGroup.className = 'theia-mobile-onboarding-dismiss';

        const skipBtn = document.createElement('button');
        skipBtn.type = 'button';
        skipBtn.className = 'theia-mobile-onboarding-btn theia-mod-skip';
        skipBtn.textContent = nls.localizeByDefault('Skip');
        skipBtn.addEventListener('click', () => this.dismiss(true));
        dismissGroup.appendChild(skipBtn);

        // "Remind later" closes without marking the tour permanently seen, so it reappears on a fresh
        // session — unlike Skip, which suppresses it for good. Both close it for the current session.
        const remindBtn = document.createElement('button');
        remindBtn.type = 'button';
        remindBtn.className = 'theia-mobile-onboarding-btn theia-mod-remind';
        remindBtn.textContent = nls.localize('qaap/mobileOnboarding/remindLater', 'Remind later');
        remindBtn.addEventListener('click', () => this.remindLater());
        dismissGroup.appendChild(remindBtn);

        actions.appendChild(dismissGroup);

        const navGroup = document.createElement('div');
        navGroup.className = 'theia-mobile-onboarding-nav';

        if (this.currentIndex > 0) {
            const backBtn = document.createElement('button');
            backBtn.type = 'button';
            backBtn.className = 'theia-mobile-onboarding-btn theia-mod-back';
            backBtn.textContent = nls.localizeByDefault('Back');
            backBtn.addEventListener('click', () => this.previous());
            navGroup.appendChild(backBtn);
        }

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'theia-mobile-onboarding-btn theia-mod-next';
        nextBtn.textContent = this.currentIndex === this.steps.length - 1
            ? nls.localizeByDefault('Done')
            : nls.localizeByDefault('Next');
        nextBtn.addEventListener('click', () => this.next());
        navGroup.appendChild(nextBtn);

        actions.appendChild(navGroup);
        fragment.appendChild(actions);
        return fragment;
    }

    protected renderDemo(step: TutorialStep): void {
        if (!this.demoLayer) {
            return;
        }
        this.demoLayer.replaceChildren();
        this.demoLayer.classList.remove('theia-mod-swipe-right', 'theia-mod-tap');
        if (step.demo === 'swipe-right') {
            this.demoLayer.classList.add('theia-mod-swipe-right');
            const dot = document.createElement('div');
            dot.className = 'theia-mobile-onboarding-finger';
            const arrow = document.createElement('span');
            arrow.className = 'theia-mobile-onboarding-arrow codicon codicon-arrow-right';
            this.demoLayer.append(dot, arrow);
        } else if (step.demo === 'tap') {
            this.demoLayer.classList.add('theia-mod-tap');
            const pulse = document.createElement('div');
            pulse.className = 'theia-mobile-onboarding-pulse';
            this.demoLayer.appendChild(pulse);
        }
    }

    protected positionForCurrentStep(): void {
        const step = this.steps[this.currentIndex];
        if (!step || !this.spotlight || !this.tooltip || !this.demoLayer) {
            return;
        }
        const target = step.target?.();
        const rect = target?.getBoundingClientRect();
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const tooltipMargin = 12;

        // Spotlight
        const hasSpotlight = !!rect && rect.width > 0 && rect.height > 0;
        if (hasSpotlight && rect) {
            // Pad the spotlight a few px so the focus ring sits outside the target.
            const pad = 6;
            this.spotlight.style.display = 'block';
            this.spotlight.style.top = `${Math.max(rect.top - pad, 0)}px`;
            this.spotlight.style.left = `${Math.max(rect.left - pad, 0)}px`;
            this.spotlight.style.width = `${rect.width + pad * 2}px`;
            this.spotlight.style.height = `${rect.height + pad * 2}px`;
        } else {
            this.spotlight.style.display = 'none';
        }
        // Drive the backdrop from an explicit class rather than a brittle inline-style selector:
        // a spotlight step replaces the dim backdrop with its giant ring shadow, while a centered
        // step (no spotlight) needs the dim backdrop so the tooltip reads against the live workbench.
        this.overlay?.classList.toggle('theia-mod-has-spotlight', hasSpotlight);

        // Tooltip placement
        const tooltip = this.tooltip;
        tooltip.classList.remove('theia-mod-place-top', 'theia-mod-place-bottom', 'theia-mod-place-center');
        let placement = step.placement;
        if (placement !== 'center' && (!rect || rect.width === 0 || rect.height === 0)) {
            placement = 'center';
        }

        if (placement === 'center') {
            tooltip.classList.add('theia-mod-place-center');
            tooltip.style.removeProperty('top');
            tooltip.style.removeProperty('bottom');
            tooltip.style.left = '50%';
            tooltip.style.transform = 'translate(-50%, -50%)';
            tooltip.style.top = '50%';
        } else if (placement === 'top' && rect) {
            tooltip.classList.add('theia-mod-place-top');
            const bottomAnchor = viewportH - rect.top + tooltipMargin;
            tooltip.style.removeProperty('top');
            tooltip.style.bottom = `${Math.max(bottomAnchor, 16)}px`;
            tooltip.style.left = '50%';
            tooltip.style.transform = 'translateX(-50%)';
        } else if (placement === 'bottom' && rect) {
            tooltip.classList.add('theia-mod-place-bottom');
            const topAnchor = rect.bottom + tooltipMargin;
            tooltip.style.removeProperty('bottom');
            tooltip.style.top = `${Math.min(topAnchor, viewportH - 16)}px`;
            tooltip.style.left = '50%';
            tooltip.style.transform = 'translateX(-50%)';
        }

        // Demo overlay (swipe / tap) anchored to the spotlight where appropriate.
        if (step.demo === 'swipe-right') {
            this.demoLayer.style.display = 'block';
            this.demoLayer.style.top = `${Math.round(viewportH * 0.5) - 24}px`;
            this.demoLayer.style.left = '12px';
            this.demoLayer.style.width = `${Math.min(viewportW - 24, 240)}px`;
            this.demoLayer.style.height = '48px';
        } else if (step.demo === 'tap' && rect) {
            this.demoLayer.style.display = 'block';
            this.demoLayer.style.top = `${rect.top + rect.height / 2 - 24}px`;
            this.demoLayer.style.left = `${rect.left + rect.width / 2 - 24}px`;
            this.demoLayer.style.width = '48px';
            this.demoLayer.style.height = '48px';
        } else {
            this.demoLayer.style.display = 'none';
        }
    }

    /** Exposed for tests. */
    isActive(): boolean { return this.active; }
}
