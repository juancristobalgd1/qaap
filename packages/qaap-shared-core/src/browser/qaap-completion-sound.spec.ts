// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapCompletionSound, QaapCompletionSoundKind } from './qaap-completion-sound';
import { QaapWorkHubNotificationSettings } from './qaap-work-hub-notification-settings';

class TestCompletionSound extends QaapCompletionSound {
    clock = 10_000;
    played: QaapCompletionSoundKind[] = [];

    protected override now(): number {
        return this.clock;
    }

    protected override getAudioContext(): AudioContext | undefined {
        return undefined;
    }

    override play(kind: QaapCompletionSoundKind): void {
        const before = this.lastPlayedAt;
        super.play(kind);
        if (this.lastPlayedAt !== before) {
            this.played.push(kind);
        }
    }
}

describe('QaapCompletionSound', () => {
    const settingsWith = (completionSound: boolean): QaapWorkHubNotificationSettings => ({ completionSound } as QaapWorkHubNotificationSettings);

    it('does nothing while the Completion Sound setting is OFF', () => {
        const sound = new TestCompletionSound();
        (sound as unknown as { settings: QaapWorkHubNotificationSettings }).settings = settingsWith(false);
        sound.play('completed');
        expect(sound.played).to.deep.equal([]);
    });

    it('plays when ON and deduplicates calls within 1.5 s', () => {
        const sound = new TestCompletionSound();
        (sound as unknown as { settings: QaapWorkHubNotificationSettings }).settings = settingsWith(true);
        sound.play('completed');
        sound.clock += 500;
        sound.play('attention');
        expect(sound.played).to.deep.equal(['completed']);
        sound.clock += 1500;
        sound.play('attention');
        expect(sound.played).to.deep.equal(['completed', 'attention']);
    });
});
