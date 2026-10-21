// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveQaapDockerLogConfig } from './qaap-docker-control-plane';

describe('resolveQaapDockerLogConfig', () => {
    it('defaults to 5 x 50m like the compose services', () => {
        expect(resolveQaapDockerLogConfig({})).to.deep.equal({ Type: 'json-file', Config: { 'max-size': '50m', 'max-file': '5' } });
    });

    it('reads QAAP_LOG_MAX_SIZE and QAAP_LOG_MAX_FILE, as x-qaap-logging does', () => {
        expect(resolveQaapDockerLogConfig({ QAAP_LOG_MAX_SIZE: ' 200M ', QAAP_LOG_MAX_FILE: '3' }).Config)
            .to.deep.equal({ 'max-size': '200m', 'max-file': '3' });
    });

    it('never lets an invalid value turn rotation off', () => {
        for (const [size, file] of [['', ''], ['0m', '0'], ['-1', '-1'], ['50', 'x'], ['unlimited', '1000'], ['50m; rm', '5 6']]) {
            expect(resolveQaapDockerLogConfig({ QAAP_LOG_MAX_SIZE: size, QAAP_LOG_MAX_FILE: file }).Config)
                .to.deep.equal({ 'max-size': '50m', 'max-file': '5' });
        }
    });
});
