import * as fs from 'fs';
import * as path from 'path';

const workspace = path.resolve(process.argv[2]);
const promptFile = path.resolve(process.argv[3]);
const prompt = fs.readFileSync(promptFile, 'utf8');

if (!/vulnerabilidades|security audit/i.test(prompt)
    || !fs.existsSync(path.join(workspace, 'server/routes/preview.js'))) {
    process.stderr.write('Unexpected security-audit fixture or prompt.\n');
    process.exit(1);
}

const report = `# Scope
Static source review of public routes, authorization boundaries, and browser rendering. Runtime behavior was not verified.

## Finding 1 — High confidence, High severity: SSRF in preview proxy
Evidence: server/routes/preview.js:2 takes request.query.url and server/routes/preview.js:3 passes it to fetch without scheme, DNS, redirect, or private-address validation. server/app.js:5 exposes the route without authentication.
Preconditions: an unauthenticated attacker can reach GET /api/preview.
Safe reproduction: in an isolated test double, request /api/preview?url=http://127.0.0.1:3001/health.
Expected: reject loopback/private destinations. Observed from static analysis: the handler follows redirects and fetches the supplied target.
Impact: access to services reachable from the application host and response disclosure.
Remediation: allowlist schemes and destinations, resolve and block private ranges on every redirect, and isolate egress.

## Finding 2 — High confidence, Medium severity: stored XSS in profile bio
Evidence: server/routes/profile.js:4 stores attacker-controlled request.body.bio; server/routes/profile.js:11 returns it; web/profile-card.js:4 inserts response.bio with innerHTML. The profile GET route is public.
Preconditions: an authenticated attacker can save a bio and a victim opens that profile.
Safe reproduction: save <img src=x onerror=alert(1)> as the bio in a local fixture, then render the profile card.
Expected: display the payload as text. Observed from static analysis: the value reaches innerHTML without encoding or sanitization.
Impact: script execution in a viewer's origin.
Remediation: use textContent, or a rigorously configured HTML sanitizer if markup is required.

## Rejected leads and limitations
safe-admin.js enforces both the platform-admin role and tenant membership, so it was rejected as a false positive. safe-notification.js uses textContent and is safe for the reviewed sink. No commands other than source inspection were run; dependencies, deployment configuration, and runtime defenses were not verified.`;

process.stdout.write(`${JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: report,
    costUsd: 0.001,
    totalTokens: 250,
})}\n`);
