// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { QaapWorkHubNotificationSettings } from './qaap-work-hub-notification-settings';

/** Kind of moment that triggers the sound: a finished turn, or an agent waiting for the user. */
export type QaapCompletionSoundKind = 'completed' | 'attention';

interface QaapSoundNote {
    readonly frequency: number;
    readonly startSeconds: number;
    readonly durationSeconds: number;
}

/**
 * Short, quiet two-note chime synthesized with WebAudio (no assets). Plays only while the
 * Completion Sound setting is ON, and never more than once per `MIN_INTERVAL_MS` so chained
 * events collapse into a single chime.
 */
@injectable()
export class QaapCompletionSound {

    protected static readonly MIN_INTERVAL_MS = 1500;
    protected static readonly PEAK_GAIN = 0.08;

    /** Plain field (not DI-injected) so host-instantiated Work Hub code can construct the sound directly. */
    protected readonly settings: QaapWorkHubNotificationSettings = new QaapWorkHubNotificationSettings();

    protected lastPlayedAt = Number.NEGATIVE_INFINITY;
    protected audioContext: AudioContext | undefined;

    /** Plays the chime for `kind` if the setting is ON and the dedupe window has passed. */
    play(kind: QaapCompletionSoundKind): void {
        if (!this.settings.completionSound) {
            return;
        }
        const now = this.now();
        if (now - this.lastPlayedAt < QaapCompletionSound.MIN_INTERVAL_MS) {
            return;
        }
        this.lastPlayedAt = now;
        try {
            const context = this.getAudioContext();
            if (!context) {
                return;
            }
            if (context.state === 'suspended') {
                void context.resume();
            }
            const notes = kind === 'attention' ? ATTENTION_NOTES : COMPLETED_NOTES;
            for (const note of notes) {
                this.playNote(context, note);
            }
        } catch {
            /* AudioContext can be unavailable or blocked in restricted contexts */
        }
    }

    protected now(): number {
        return Date.now();
    }

    protected getAudioContext(): AudioContext | undefined {
        if (this.audioContext) {
            return this.audioContext;
        }
        if (typeof window === 'undefined') {
            return undefined;
        }
        const Ctor: typeof AudioContext | undefined = window.AudioContext
            ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
            return undefined;
        }
        this.audioContext = new Ctor();
        return this.audioContext;
    }

    protected playNote(context: AudioContext, note: QaapSoundNote): void {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + note.startSeconds;
        const end = start + note.durationSeconds;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(note.frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(QaapCompletionSound.PEAK_GAIN, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(end + 0.02);
    }
}

/** Two soft rising notes (C6 then G6), about 250 ms in total. */
const COMPLETED_NOTES: readonly QaapSoundNote[] = [
    { frequency: 1046.5, startSeconds: 0, durationSeconds: 0.12 },
    { frequency: 1568, startSeconds: 0.12, durationSeconds: 0.13 },
];

/** Two soft notes (G5 then E5) for a prompt that needs the user. */
const ATTENTION_NOTES: readonly QaapSoundNote[] = [
    { frequency: 783.99, startSeconds: 0, durationSeconds: 0.12 },
    { frequency: 659.25, startSeconds: 0.12, durationSeconds: 0.13 },
];
