// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentLoginInputStep } from '@theia/qaap-shared-core/lib/common/qaap-agent-tui-command';

/** A step is typed once the CLI has been quiet this long (it finished redrawing). */
export const QAAP_AGENT_LOGIN_INPUT_SETTLE_MS = 400;
/** A step without a pattern is typed after this long even if the CLI keeps redrawing. */
export const QAAP_AGENT_LOGIN_INPUT_STEP_FALLBACK_MS = 2_500;
/** After its pattern matched, a step is typed at the latest after this long (spinners never settle). */
export const QAAP_AGENT_LOGIN_INPUT_MATCH_GRACE_MS = 1_500;
const BUFFER_LIMIT = 16_000;

export interface QaapAgentLoginInputDriverOptions {
    readonly steps: readonly QaapAgentLoginInputStep[];
    /** Writes keystrokes to the CLI's stdin. */
    readonly send: (text: string) => void;
    readonly now: number;
    /** The sequence was typed again because the CLI showed its ready pattern only after a fallback send. */
    readonly onRestart?: (now: number) => void;
}

/**
 * Types a scripted keystroke sequence into an interactive CLI (Pi's `/login`), one step at a time,
 * each only once the output printed since the previous step shows what it waits for. DOM- and
 * terminal-free: the host feeds it the visible output and clock ticks.
 */
export class QaapAgentLoginInputDriver {

    protected index = 0;
    protected buffer = '';
    protected stepStartedAt: number;
    protected lastOutputAt: number | undefined;
    protected matchedAt: number | undefined;
    /** A `waitFor` step sent without its pattern: the CLI may not have been ready for it. */
    protected fallbackIndex: number | undefined;
    /** Output printed since that fallback send. */
    protected sinceFallback = '';
    protected restartCount = 0;
    protected stopped = false;
    protected readonly patterns = new Map<string, RegExp>();

    constructor(protected readonly options: QaapAgentLoginInputDriverOptions) {
        this.stepStartedAt = options.now;
    }

    /** Every step was typed (or skipped), or the host stopped the driver. */
    get done(): boolean {
        return this.stopped || this.index >= this.options.steps.length;
    }

    /** Number of steps typed or skipped so far. */
    get position(): number {
        return this.index;
    }

    stop(): void {
        this.stopped = true;
    }

    /** Visible (escape-free) output of the CLI. */
    feed(text: string, now: number): void {
        if (this.done || !text) {
            return;
        }
        this.buffer = `${this.buffer}${text}`.slice(-BUFFER_LIMIT);
        if (this.fallbackIndex !== undefined) {
            this.sinceFallback = `${this.sinceFallback}${text}`.slice(-BUFFER_LIMIT);
        }
        this.lastOutputAt = now;
    }

    /** How many times the sequence was typed again (at most once). */
    get restarts(): number {
        return this.restartCount;
    }

    /** Types the next step when it is due; at most one step per tick so the CLI can redraw. */
    tick(now: number): void {
        this.restartIfReady(now);
        while (!this.done) {
            const step = this.options.steps[this.index];
            if (step.skipWhen && this.pattern(step.skipWhen).test(this.buffer)) {
                // The output stays: the next step may be waiting for the very same screen.
                this.index++;
                this.stepStartedAt = now;
                this.matchedAt = undefined;
                continue;
            }
            if (!this.isDue(step, now)) {
                return;
            }
            if (step.waitFor && this.matchedAt === undefined && this.restartCount === 0) {
                this.fallbackIndex = this.index;
                this.sinceFallback = '';
            }
            // Reset before sending: a terminal may echo the keystrokes synchronously.
            this.index++;
            this.buffer = '';
            this.stepStartedAt = now;
            this.lastOutputAt = undefined;
            this.matchedAt = undefined;
            this.options.send(step.text);
            return;
        }
    }

    /**
     * A `waitFor` step sent by fallback may have reached a CLI that had not started yet (keys typed
     * before its TUI owns stdin are lost). If its pattern shows up in the output printed after that
     * send, the sequence is typed again from that step, once; the host re-anchors its deadline.
     */
    protected restartIfReady(now: number): void {
        if (this.restartCount > 0 || this.fallbackIndex === undefined) {
            return;
        }
        const step = this.options.steps[this.fallbackIndex];
        if (!step.waitFor || !this.pattern(step.waitFor).test(this.sinceFallback)) {
            return;
        }
        this.restartCount++;
        const resetText = step.resetText;
        this.index = this.fallbackIndex;
        this.fallbackIndex = undefined;
        this.buffer = this.sinceFallback;
        this.sinceFallback = '';
        this.stepStartedAt = now;
        this.matchedAt = now;
        if (resetText) {
            this.options.send(resetText);
        }
        this.options.onRestart?.(now);
    }

    protected isDue(step: QaapAgentLoginInputStep, now: number): boolean {
        const quiet = this.lastOutputAt !== undefined && now - this.lastOutputAt >= QAAP_AGENT_LOGIN_INPUT_SETTLE_MS;
        if (step.waitFor) {
            if (this.matchedAt === undefined && this.pattern(step.waitFor).test(this.buffer)) {
                this.matchedAt = now;
            }
            if (this.matchedAt !== undefined) {
                return quiet || now - this.matchedAt >= QAAP_AGENT_LOGIN_INPUT_MATCH_GRACE_MS;
            }
            return step.fallbackMs !== undefined && now - this.stepStartedAt >= step.fallbackMs;
        }
        return quiet || now - this.stepStartedAt >= QAAP_AGENT_LOGIN_INPUT_STEP_FALLBACK_MS;
    }

    protected pattern(source: string): RegExp {
        let pattern = this.patterns.get(source);
        if (!pattern) {
            pattern = new RegExp(source, 'i');
            this.patterns.set(source, pattern);
        }
        return pattern;
    }
}
