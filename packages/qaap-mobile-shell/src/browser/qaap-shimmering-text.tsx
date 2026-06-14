// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as React from '@theia/core/shared/react';
import {
    getQaapAgentLoadingPhrases,
    QAAP_AGENT_LOADING_PHRASE_CYCLE_MS,
    resolveQaapAgentLoadingPhraseIndex,
} from '../common/qaap-agent-loading-phrases';

export interface QaapShimmeringTextProps {
    readonly text?: string;
    readonly cycle?: boolean;
    readonly phrases?: readonly string[];
    readonly cycleIntervalMs?: number;
    readonly className?: string;
}

export const QaapShimmeringText: React.FunctionComponent<QaapShimmeringTextProps> = ({
    text,
    cycle = false,
    phrases = getQaapAgentLoadingPhrases(),
    cycleIntervalMs = QAAP_AGENT_LOADING_PHRASE_CYCLE_MS,
    className = '',
}) => {
    const [phraseIndex, setPhraseIndex] = React.useState(0);
    const [visible, setVisible] = React.useState(true);
    const resolvedText = cycle
        ? phrases[resolveQaapAgentLoadingPhraseIndex(phraseIndex, phrases.length)] ?? text ?? ''
        : text ?? '';

    React.useEffect(() => {
        if (!cycle || phrases.length <= 1) {
            return;
        }
        const interval = window.setInterval(() => {
            setVisible(false);
            window.setTimeout(() => {
                setPhraseIndex(previous => resolveQaapAgentLoadingPhraseIndex(previous + 1, phrases.length));
                setVisible(true);
            }, 150);
        }, cycleIntervalMs);
        return () => window.clearInterval(interval);
    }, [cycle, cycleIntervalMs, phrases]);

    React.useEffect(() => {
        if (!cycle) {
            setVisible(true);
        }
    }, [cycle, resolvedText]);

    return (
        <span
            className={`qaap-shimmering-text ${className}`.trim()}
            aria-live={cycle ? 'polite' : undefined}
        >
            <span
                className={`qaap-shimmering-text-phrase${visible ? ' qaap-mod-visible' : ' qaap-mod-hidden'}`}
            >
                {resolvedText}
            </span>
        </span>
    );
};

export interface QaapChatAgentProgressLabelProps {
    readonly waitingForInput: boolean;
    readonly waitingLabel: string;
}

export const QaapChatAgentProgressLabel: React.FunctionComponent<QaapChatAgentProgressLabelProps> = ({
    waitingForInput,
    waitingLabel,
}) => {
    if (waitingForInput) {
        return (
            <span className="theia-ChatContentInProgress" role="status" aria-live="polite">
                {waitingLabel}
            </span>
        );
    }
    return (
        <span className="theia-ChatContentInProgress qaap-mod-shimmer" role="status" aria-live="polite">
            <QaapShimmeringText cycle />
        </span>
    );
};

export const QaapAgentProgressPlaceholder: React.FunctionComponent = () => (
    <span className="theia-ChatContentInProgress qaap-mod-shimmer" role="status" aria-live="polite">
        <QaapShimmeringText cycle />
    </span>
);

export const QaapDelegationProgressLabel: React.FunctionComponent<{ readonly className?: string }> = ({
    className = 'delegation-status-text',
}) => (
    <span className={`${className} qaap-mod-shimmer`}>
        <QaapShimmeringText cycle />
    </span>
);
