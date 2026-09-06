// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
'use strict';

const fs = require('node:fs');

/** Validate public readiness responses, not just their HTTP status. */
function validateReleaseConfig(config, health, expectedSha) {
    const errors = [];
    for (const [name, payload] of [['auth/config', config], ['health', health]]) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            errors.push(`${name}: expected a JSON object`);
            continue;
        }
        for (const [key, value] of Object.entries({ skipAuth: false, productionRuntime: true, agentUidPerUser: true, oauthConfigured: true })) {
            if (payload[key] !== value) {
                errors.push(`${name}: ${key} must be ${value}`);
            }
        }
        if (typeof payload.build !== 'string' || !/^[0-9a-f]{12}$/.test(payload.build)) {
            errors.push(`${name}: build must be a 12-character commit SHA`);
        }
    }
    if (config?.betaAccessRequired !== true || config?.betaAccessConfigured !== true) {
        errors.push('auth/config: server-side beta invitations must be required and configured');
    }
    if (health?.ok !== true || health?.ready !== true) {
        errors.push('health: ok and ready must both be true');
    }
    if (config?.build !== health?.build) {
        errors.push('auth/config and health report different builds');
    }
    if (expectedSha !== undefined && (!/^[0-9a-f]{40}$/.test(expectedSha) || config?.build !== expectedSha.slice(0, 12))) {
        errors.push('serving build does not match the expected release commit');
    }
    return errors;
}

module.exports = { validateReleaseConfig };

if (require.main === module) {
    try {
        const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
        const health = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
        const errors = validateReleaseConfig(config, health, process.env.QAAP_EXPECTED_BUILD_SHA);
        if (errors.length) {
            console.error(errors.join('\n'));
            process.exitCode = 1;
        } else {
            console.log('Production readiness, beta admission and build identity verified.');
        }
    } catch {
        console.error('Cannot read valid JSON readiness responses. Release blocked.');
        process.exitCode = 1;
    }
}
