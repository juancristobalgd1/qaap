// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isInQaapDockerNamespace,
    QAAP_DOCKER_NAMESPACE_LABEL,
    qaapDockerName,
    qaapDockerNamespace,
    qaapDockerNamespaceLabels,
} from './qaap-docker-namespace';

describe('qaap docker namespace', () => {

    it('leaves production names and labels untouched when no namespace is set', () => {
        expect(qaapDockerNamespace({})).to.equal('');
        expect(qaapDockerName('qaap-tenant-abc', {})).to.equal('qaap-tenant-abc');
        expect(qaapDockerNamespaceLabels({})).to.deep.equal({});
        expect(isInQaapDockerNamespace({ 'com.qaap.managed': 'true' }, {})).to.equal(true);
    });

    it('prefixes names and labels resources for a namespaced control plane', () => {
        const env = { QAAP_DOCKER_NAMESPACE: 'stg' };
        expect(qaapDockerName('qaap-tenant-abc', env)).to.equal('stg-qaap-tenant-abc');
        expect(qaapDockerNamespaceLabels(env)).to.deep.equal({ [QAAP_DOCKER_NAMESPACE_LABEL]: 'stg' });
    });

    it('keeps production and staging blind to each other', () => {
        const staging = { QAAP_DOCKER_NAMESPACE: 'stg' };
        const prodResource = { 'com.qaap.managed': 'true' };
        const stagingResource = { 'com.qaap.managed': 'true', [QAAP_DOCKER_NAMESPACE_LABEL]: 'stg' };
        expect(isInQaapDockerNamespace(stagingResource, {})).to.equal(false);
        expect(isInQaapDockerNamespace(prodResource, staging)).to.equal(false);
        expect(isInQaapDockerNamespace(stagingResource, staging)).to.equal(true);
    });

    it('rejects namespaces that would produce invalid or confusable Docker names', () => {
        expect(() => qaapDockerNamespace({ QAAP_DOCKER_NAMESPACE: 'qaap-' })).to.throw(/QAAP_DOCKER_NAMESPACE/);
        expect(() => qaapDockerNamespace({ QAAP_DOCKER_NAMESPACE: '1stg' })).to.throw(/QAAP_DOCKER_NAMESPACE/);
    });
});
