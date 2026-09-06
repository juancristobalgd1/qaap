// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { readQaapHostedRuntime, rememberQaapHostedRuntime } from './qaap-hosted-runtime';

describe('qaap-hosted-runtime', () => {
    afterEach(() => {
        rememberQaapHostedRuntime(false);
    });

    it('defaults to a local/dev runtime', () => {
        expect(readQaapHostedRuntime()).to.equal(false);
    });

    it('remembers an explicit hosted flag', () => {
        rememberQaapHostedRuntime(true);
        expect(readQaapHostedRuntime()).to.equal(true);
        rememberQaapHostedRuntime(false);
        expect(readQaapHostedRuntime()).to.equal(false);
    });
});
