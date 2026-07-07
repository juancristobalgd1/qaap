// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveAgentSpawnIdentity } from './qaap-agent-spawn-identity';

describe('resolveAgentSpawnIdentity', () => {
    it('returns empty when QAAP_AGENT_UID is unset (local dev unchanged)', () => {
        expect(resolveAgentSpawnIdentity({}, true)).to.deep.equal({});
    });

    it('drops to the requested uid when the backend is root', () => {
        expect(resolveAgentSpawnIdentity({ QAAP_AGENT_UID: '1000' }, true)).to.deep.equal({ uid: 1000 });
    });

    it('includes gid when QAAP_AGENT_GID is a valid integer', () => {
        expect(resolveAgentSpawnIdentity({ QAAP_AGENT_UID: '1000', QAAP_AGENT_GID: '1000' }, true))
            .to.deep.equal({ uid: 1000, gid: 1000 });
    });

    it('flags warnNotRoot (and does not drop) when a uid is requested but the backend is not root', () => {
        expect(resolveAgentSpawnIdentity({ QAAP_AGENT_UID: '1000' }, false)).to.deep.equal({ warnNotRoot: true });
    });

    it('ignores an invalid uid', () => {
        expect(resolveAgentSpawnIdentity({ QAAP_AGENT_UID: 'nope' }, true)).to.deep.equal({});
        expect(resolveAgentSpawnIdentity({ QAAP_AGENT_UID: '-5' }, true)).to.deep.equal({});
    });

    it('ignores an invalid gid but keeps the uid', () => {
        expect(resolveAgentSpawnIdentity({ QAAP_AGENT_UID: '1000', QAAP_AGENT_GID: 'x' }, true))
            .to.deep.equal({ uid: 1000 });
    });
});
