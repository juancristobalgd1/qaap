// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as React from '@theia/core/shared/react';
import { mountQaapCounterPush, type QaapCounterPushHandle } from './qaap-counter-push-dom';

export interface QaapCounterPushTextProps {
    readonly value: number;
    readonly format: (value: number) => string;
    readonly className?: string;
    readonly animate?: boolean;
}

/** React wrapper for the Codex/Cursor-style vertical push counter. */
export const QaapCounterPushText: React.FunctionComponent<QaapCounterPushTextProps> = ({
    value,
    format,
    className,
    animate = true,
}) => {
    const hostRef = React.useRef<HTMLSpanElement>(null);
    const handleRef = React.useRef<QaapCounterPushHandle | undefined>(undefined);
    const formatRef = React.useRef(format);
    formatRef.current = format;

    React.useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host || handleRef.current) {
            return;
        }
        handleRef.current = mountQaapCounterPush({
            value,
            format: formatRef.current,
            className,
        });
        host.append(handleRef.current.element);
    }, [className]);

    React.useLayoutEffect(() => {
        handleRef.current?.setValue(value, { animate });
    }, [value, animate]);

    React.useLayoutEffect(() => () => {
        handleRef.current?.dispose();
        handleRef.current = undefined;
    }, []);

    return <span ref={hostRef} className='qaap-counter-push-host' aria-hidden='true' />;
};

export const QaapDiffAddCounter: React.FunctionComponent<{ readonly value: number }> = ({ value }) => (
    <span className='qaap-diff-add'>
        <QaapCounterPushText value={value} format={next => `+${next}`} />
    </span>
);

export const QaapDiffDelCounter: React.FunctionComponent<{ readonly value: number }> = ({ value }) => (
    <span className='qaap-diff-del'>
        <QaapCounterPushText value={value} format={next => `−${next}`} />
    </span>
);
