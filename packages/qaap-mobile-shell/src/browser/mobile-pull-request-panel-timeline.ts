// @ts-nocheck
// Extracted from mobile-pull-request-panel.ts

import { nls } from '@theia/core/lib/common/nls';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    fetchQaapGithubPullRequests,
    mergeQaapGithubPullRequest,
    startGithubOAuth,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type {
    QaapGithubPullRequestFile,
    QaapGithubPullRequestLine,
    QaapGithubPullRequestSummary,
    QaapGithubRepositorySummary,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    createMobileSheetGrabber,
    installMobilePullToRefresh,
    installMobileSheetDragDismiss,
} from './mobile-sheet-gestures';
import { MobileSnackbar } from './mobile-snackbar';

export function decideTopExtracted(ctx: any, decision: PullRequestDecision, comment?: string): void {
        const top = ctx.queue[0];
        if (!top || ctx.animating) {
            return;
        }
        ctx.animating = true;
        ctx.dragX = decision === 'approved' ? 420 : -420;
        ctx.applyDragStyles(ctx.stack.querySelector('.theia-mobile-pr-card-host'), true);
        window.setTimeout(() => {
            const review: PullRequestReview = { decision, comment };
            ctx.decisions.set(top.f, review);
            ctx.history.push({ file: top, review });
            ctx.queue = ctx.queue.filter(file => file.f !== top.f);
            ctx.dragX = 0;
            ctx.animating = false;
            ctx.expanded = false;
            ctx.mergeState = 'idle';
            ctx.confirmingMerge = false;
            ctx.mergeError = undefined;
            ctx.saveReviewState();
            ctx.render();
            ctx.showUndoToast(top, review);
        }, 220);
}

export function startMergeConfirmationExtracted(ctx: any): void {
        if (ctx.mergeState === 'failed') {
            void ctx.executeMergeAndDeploy();
            return;
        }
        if (ctx.queue.length > 0 || ctx.mergeState !== 'idle') {
            return;
        }
        const stats = ctx.reviewStats();
        if (stats.rejected > 0 || stats.commented > 0) {
            return;
        }
        ctx.confirmingMerge = true;
        ctx.render();
}

export async function executeMergeAndDeployExtracted(ctx: any): Promise<void> {
        const pr = ctx.activePullRequest;
        if (!pr || ctx.queue.length > 0 || ctx.mergeState === 'merging' || ctx.mergeState === 'deploying') {
            return;
        }
        ctx.clearMergeTimer();
        ctx.confirmingMerge = false;
        ctx.mergeError = undefined;
        ctx.mergeState = 'merging';
        ctx.render();
        try {
            const result = await mergeQaapGithubPullRequest({
                owner: pr.owner,
                repo: pr.repo,
                number: pr.number,
            });
            if (!result.merged) {
                throw new Error(result.message);
            }
            ctx.mergeState = 'deploying';
            ctx.render();
            await ctx.delay(900);
            ctx.mergeState = 'merged';
            ctx.saveReviewState();
            ctx.render();
            ctx.showToast(nls.localize('qaap/mobilePr/mergeDeployNotice', 'Merged. Deploy started for the current repository.'), 'success');
            ctx.fireConfetti();
        } catch (error) {
            ctx.mergeState = 'failed';
            ctx.mergeError = error instanceof Error ? error.message : nls.localize('qaap/mobilePr/mergeFailedGeneric', 'Merge failed.');
            ctx.render();
            ctx.showToast(ctx.mergeError, 'error');
        }
}

export function undoExtracted(ctx: any): void {
        const last = ctx.history.pop();
        if (!last || ctx.mergeState === 'merging' || ctx.mergeState === 'deploying') {
            return;
        }
        ctx.clearMergeTimer();
        ctx.hideToast();
        ctx.decisions.delete(last.file.f);
        ctx.queue = [last.file, ...ctx.queue.filter(file => file.f !== last.file.f)];
        ctx.dragX = 0;
        ctx.expanded = false;
        ctx.mergeState = 'idle';
        ctx.confirmingMerge = false;
        ctx.mergeError = undefined;
        ctx.saveReviewState();
        ctx.render();
}

export function resetExtracted(ctx: any): void {
        ctx.clearMergeTimer();
        ctx.hideToast();
        ctx.decisions.clear();
        ctx.history = [];
        ctx.dragX = 0;
        ctx.expanded = false;
        ctx.mergeState = 'idle';
        ctx.confirmingMerge = false;
        ctx.mergeError = undefined;
        ctx.queue = ctx.activePullRequest?.filesPreview ? [...ctx.activePullRequest.filesPreview] : [];
        ctx.saveReviewState();
        ctx.render();
}

export function showUndoToastExtracted(ctx: any, file: QaapGithubPullRequestFile, review: PullRequestReview): void {
        ctx.hideToast();
        ctx.toast.replaceChildren();
        ctx.toast.classList.remove('theia-mod-success', 'theia-mod-error');
        const label = ctx.createTextSpan(`${ctx.reviewLabel(review)} ${file.f}`);
        const undo = document.createElement('button');
        undo.type = 'button';
        undo.textContent = nls.localize('qaap/mobilePr/undo', 'Undo');
        undo.addEventListener('click', () => ctx.undo());
        ctx.toast.append(label, undo);
        ctx.toast.hidden = false;
        ctx.toast.classList.add('theia-mod-visible');
        ctx.toastTimer = window.setTimeout(() => ctx.hideToast(), 3200);
}

export function showToastExtracted(ctx: any, message: string, kind: ToastKind = 'default'): void {
        ctx.hideToast();
        ctx.toast.replaceChildren(ctx.createTextSpan(message));
        ctx.toast.classList.remove('theia-mod-success', 'theia-mod-error');
        if (kind !== 'default') {
            ctx.toast.classList.add(`theia-mod-${kind}`);
        }
        ctx.toast.hidden = false;
        ctx.toast.classList.add('theia-mod-visible');
        ctx.toastTimer = window.setTimeout(() => ctx.hideToast(), kind === 'success' ? 5200 : 3600);
}

export function hideToastExtracted(ctx: any): void {
        if (ctx.toastTimer !== undefined) {
            window.clearTimeout(ctx.toastTimer);
            ctx.toastTimer = undefined;
        }
        ctx.toast.classList.remove('theia-mod-visible');
        ctx.toast.hidden = true;
}

export function fireConfettiExtracted(ctx: any): void {
        const existing = ctx.root.querySelector('.theia-mobile-pr-confetti');
        existing?.remove();
        const confetti = document.createElement('div');
        confetti.className = 'theia-mobile-pr-confetti';
        confetti.setAttribute('aria-hidden', 'true');
        const colors = ['#2f7d4a', '#f2c94c', '#56a0d3', '#d96941', '#8a63d2'];
        for (let index = 0; index < 28; index++) {
            const piece = document.createElement('span');
            piece.style.setProperty('--x', `${Math.round((Math.random() - 0.5) * 260)}px`);
            piece.style.setProperty('--delay', `${Math.random() * 180}ms`);
            piece.style.setProperty('--rot', `${Math.round(Math.random() * 520 - 260)}deg`);
            piece.style.setProperty('--color', colors[index % colors.length]);
            confetti.appendChild(piece);
        }
        ctx.root.appendChild(confetti);
        window.setTimeout(() => confetti.remove(), 1700);
}

export function reviewLabelExtracted(ctx: any, review: PullRequestReview): string {
        if (review.comment) {
            return review.comment;
        }
        if (review.decision === 'approved') {
            return nls.localize('qaap/mobilePr/approved', 'Approved');
        }
        if (review.decision === 'commented') {
            return nls.localize('qaap/mobilePr/noted', 'Noted');
        }
        return nls.localize('qaap/mobilePr/changesRequested', 'Changes requested');
}

export function reviewStatsExtracted(ctx: any): { total: number; reviewed: number; approved: number; rejected: number; commented: number } {
        const values = [...ctx.decisions.values()];
        return {
            total: ctx.activePullRequest?.filesPreview.length ?? 0,
            reviewed: values.length,
            approved: values.filter(value => value.decision === 'approved').length,
            rejected: values.filter(value => value.decision === 'rejected').length,
            commented: values.filter(value => value.decision === 'commented').length,
        };
}

export function saveReviewStateExtracted(ctx: any): void {
        const pr = ctx.activePullRequest;
        if (!pr) {
            return;
        }
        try {
            const stored: StoredPullRequestReview = {
                decisions: [...ctx.decisions.entries()],
                history: ctx.history.map(entry => ({ path: entry.file.f, review: entry.review })),
                mergeState: ctx.mergeState === 'merged' ? 'merged' : undefined,
            };
            window.localStorage.setItem(ctx.storageKey(pr), JSON.stringify(stored));
        } catch {
            /* ignore storage quota/privacy failures */
        }
}

export function readStoredReviewExtracted(ctx: any, pr: QaapGithubPullRequestSummary): StoredPullRequestReview | undefined {
        try {
            const raw = window.localStorage.getItem(ctx.storageKey(pr));
            return raw ? JSON.parse(raw) as StoredPullRequestReview : undefined;
        } catch {
            return undefined;
        }
}

export function clearMergeTimerExtracted(ctx: any): void {
        if (ctx.mergeTimer !== undefined) {
            window.clearTimeout(ctx.mergeTimer);
            ctx.mergeTimer = undefined;
        }
}

export function delayExtracted(ctx: any, ms: number): Promise<void> {
        return new Promise(resolve => {
            ctx.mergeTimer = window.setTimeout(() => {
                ctx.mergeTimer = undefined;
                resolve();
            }, ms);
        });
}

export function applyDragStylesExtracted(ctx: any, host: Element | null, animate = false): void {
        if (!(host instanceof HTMLElement)) {
            return;
        }
        const clamped = Math.max(-220, Math.min(220, ctx.dragX));
        const approveOpacity = Math.max(0, Math.min(1, clamped / 80));
        const rejectOpacity = Math.max(0, Math.min(1, -clamped / 80));
        const top = host.querySelector<HTMLElement>('.theia-mobile-pr-card.theia-mod-top');
        const approve = host.querySelector<HTMLElement>('.theia-mobile-pr-backdrop.theia-mod-approve');
        const reject = host.querySelector<HTMLElement>('.theia-mobile-pr-backdrop.theia-mod-reject');
        if (top) {
            top.style.transform = `translateX(${clamped}px) rotate(${clamped * 0.02}deg)`;
            top.style.transition = animate ? 'transform 180ms ease, opacity 180ms ease' : 'none';
        }
        if (approve) {
            approve.style.opacity = String(approveOpacity);
        }
        if (reject) {
            reject.style.opacity = String(rejectOpacity);
        }
}

export function createTestsPillExtracted(ctx: any, tests: QaapGithubPullRequestSummary['tests']): HTMLElement {
        const span = document.createElement('span');
        span.className = `theia-mod-tests theia-mod-tests-${tests}`;
        const icon = tests === 'failing' ? 'codicon-close' : tests === 'pending' ? 'codicon-clock' : tests === 'unknown' ? 'codicon-question' : 'codicon-check';
        span.append(ctx.createIcon(icon), document.createTextNode(` tests ${tests}`));
        return span;
}

export function createIconExtracted(ctx: any, icon: string): HTMLElement {
        const span = document.createElement('span');
        span.className = `codicon ${icon}`;
        span.setAttribute('aria-hidden', 'true');
        return span;
}

export function createTextSpanExtracted(ctx: any, text: string): HTMLElement {
        const span = document.createElement('span');
        span.textContent = text;
        return span;
}

export function createClassedTextSpanExtracted(ctx: any, className: string, text: string): HTMLElement {
        const span = ctx.createTextSpan(text);
        span.className = className;
        return span;
}

