// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QAAP_AGENT_MODEL_UNAVAILABLE_MAX_ENTRIES,
    QAAP_AGENT_MODEL_UNAVAILABLE_TTL_MS,
    QaapAgentModelUnavailableRegistry,
} from './qaap-agent-model-unavailable-registry';

/** Registry whose clock the test moves by hand. */
class ClockedRegistry extends QaapAgentModelUnavailableRegistry {
    time = 1_000_000;
    constructor() {
        super();
        this.now = () => this.time;
    }
}

describe('QaapAgentModelUnavailableRegistry', () => {
    it('remembers a recorded model for the same owner and agent until the 6-hour TTL', () => {
        const registry = new ClockedRegistry();
        registry.record('alice', 'pi', 'github-copilot claude-haiku-4.5');
        expect(registry.isUnavailable('alice', 'pi', 'github-copilot claude-haiku-4.5')).to.equal(true);
        registry.time += QAAP_AGENT_MODEL_UNAVAILABLE_TTL_MS - 1;
        expect(registry.isUnavailable('alice', 'pi', 'github-copilot claude-haiku-4.5')).to.equal(true);
        registry.time += 1;
        expect(registry.isUnavailable('alice', 'pi', 'github-copilot claude-haiku-4.5')).to.equal(false);
    });

    it('is keyed by owner, agent and model, case-insensitively for owner and agent', () => {
        const registry = new ClockedRegistry();
        registry.record('Alice', 'Pi', 'model-a');
        expect(registry.isUnavailable('alice', 'pi', 'model-a')).to.equal(true);
        expect(registry.isUnavailable('bob', 'pi', 'model-a')).to.equal(false);
        expect(registry.isUnavailable('alice', 'codex', 'model-a')).to.equal(false);
        expect(registry.isUnavailable('alice', 'pi', 'model-b')).to.equal(false);
    });

    it('restarts the TTL when the same model is recorded again', () => {
        const registry = new ClockedRegistry();
        registry.record('alice', 'pi', 'model-a');
        registry.time += QAAP_AGENT_MODEL_UNAVAILABLE_TTL_MS - 10;
        registry.record('alice', 'pi', 'model-a');
        registry.time += 100;
        expect(registry.isUnavailable('alice', 'pi', 'model-a')).to.equal(true);
    });

    it('drops the oldest finding once the bound is exceeded', () => {
        const registry = new ClockedRegistry();
        for (let index = 0; index < QAAP_AGENT_MODEL_UNAVAILABLE_MAX_ENTRIES; index++) {
            registry.record('alice', 'pi', `model-${index}`);
        }
        registry.record('alice', 'pi', 'model-new');
        expect(registry.isUnavailable('alice', 'pi', 'model-0')).to.equal(false);
        expect(registry.isUnavailable('alice', 'pi', 'model-1')).to.equal(true);
        expect(registry.isUnavailable('alice', 'pi', 'model-new')).to.equal(true);
    });

    it('ignores blank owner-less identifiers and clear() forgets everything', () => {
        const registry = new ClockedRegistry();
        registry.record('alice', ' ', 'model-a');
        registry.record('alice', 'pi', '');
        expect(registry.isUnavailable('alice', ' ', 'model-a')).to.equal(false);
        registry.record(undefined, 'pi', 'model-a');
        expect(registry.isUnavailable(undefined, 'pi', 'model-a')).to.equal(true);
        registry.clear();
        expect(registry.isUnavailable(undefined, 'pi', 'model-a')).to.equal(false);
    });
});
