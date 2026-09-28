// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { syncShimmerTextElement } from './qaap-agent-setup-phrases';

describe('qaap-agent-setup-phrases', () => {

    it('renders shimmer letters through the container document even when the global document is gone', () => {
        const container = document.createElement('span');
        document.body.append(container);
        const globals = globalThis as { document?: Document };
        const saved = globals.document;
        delete globals.document;
        try {
            syncShimmerTextElement(container, 'Hi');
        } finally {
            globals.document = saved;
            container.remove();
        }
        expect(container.childElementCount).to.equal(2);
        expect(container.getAttribute('aria-label')).to.equal('Hi');
    });
});
