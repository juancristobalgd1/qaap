// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('Caddy request limits', () => {
    const repoRoot = path.resolve(__dirname, '../../../..');
    const read = (relative: string): string => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

    for (const site of ['deploy/caddy/Caddyfile', 'deploy/caddy/staging.caddy']) {
        it(`caps request bodies before proxying in ${site}`, () => {
            const config = read(site);
            expect(config).to.match(/request_body\s*\{\s*max_size \{\$QAAP_REQUEST_BODY_MAX_SIZE:512MB\}\s*\}/);
            expect(config.indexOf('request_body')).to.be.lessThan(config.indexOf('reverse_proxy'));
        });
    }

    it('passes the operator override through to the Caddy container', () => {
        expect(read('docker-compose.yml')).to.contain('QAAP_REQUEST_BODY_MAX_SIZE: ${QAAP_REQUEST_BODY_MAX_SIZE:-512MB}');
    });

    it('passes the per-login API and preview limits through to the backend', () => {
        const compose = read('docker-compose.yml');
        expect(compose).to.contain('QAAP_API_RATE_LIMIT_BURST: ${QAAP_API_RATE_LIMIT_BURST:-240}');
        expect(compose).to.contain('QAAP_API_RATE_LIMIT_PER_SECOND: ${QAAP_API_RATE_LIMIT_PER_SECOND:-10}');
        expect(compose).to.contain('QAAP_PREVIEW_MAX_PER_OWNER: ${QAAP_PREVIEW_MAX_PER_OWNER:-20}');
    });
});
