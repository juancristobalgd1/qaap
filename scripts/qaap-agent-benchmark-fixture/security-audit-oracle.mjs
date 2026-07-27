import * as fs from 'fs';
import * as path from 'path';

const mode = process.argv[2];
const outputPath = path.resolve(process.argv[3] ?? '');
const report = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';

function fail(message) {
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
}

function requireMatch(pattern, message) {
    if (!pattern.test(report)) {
        fail(message);
    }
}

function paragraphFor(file) {
    return report
        .split(/\n\s*\n/)
        .find(paragraph => paragraph.includes(file)) ?? '';
}

if (!report.trim()) {
    fail('The agent did not produce a final audit report.');
} else if (mode === 'coverage') {
    requireMatch(/server\/routes\/preview\.js:\d+/i, 'Missing path:line evidence for the preview route.');
    requireMatch(/\bSSRF\b|server[- ]side request forgery/i, 'The report did not identify the seeded SSRF.');
    requireMatch(/web\/profile-card\.js:\d+/i, 'Missing path:line evidence for the profile renderer.');
    requireMatch(/\b(?:stored|persisted|almacenad[oa])\s+XSS\b|cross[- ]site scripting/i,
        'The report did not identify the seeded stored XSS.');
} else if (mode === 'evidence') {
    requireMatch(/(?:127\.0\.0\.1|localhost|169\.254\.169\.254)/i,
        'The SSRF finding lacks a safe, concrete target for reproduction.');
    requireMatch(/(?:<img|<svg|onerror\s*=|onload\s*=)/i,
        'The stored-XSS finding lacks a safe, concrete payload for reproduction.');
    requireMatch(/\b(?:preconditions?|precondiciones?|requires?|requiere)\b/i,
        'The report does not state exploit preconditions.');
    requireMatch(/\bexpected\b[\s\S]{0,400}\bobserved\b|\besperad[oa]\b[\s\S]{0,400}\bobservad[oa]\b/i,
        'The report does not distinguish expected from observed behavior.');
    requireMatch(/\b(?:not verified|unverified|static analysis|source review|no verificado|an[aá]lisis est[aá]tico)\b/i,
        'The report does not disclose whether runtime verification occurred.');
    requireMatch(/\b(?:scope|alcance)\b/i, 'The report does not state the audited scope.');
} else if (mode === 'calibration') {
    if (/(?:severity|severidad)\s*[:=-]\s*(?:critical|cr[ií]tic[oa])\b/i.test(report)) {
        fail('The seeded findings do not justify Critical severity.');
    }
    for (const safeFile of ['safe-admin.js', 'safe-notification.js']) {
        const paragraph = paragraphFor(safeFile);
        const accusesSafeCode = /\b(?:vulnerab|bypass|broken access|exploit|high|critical|alto|cr[ií]tic)\b/i.test(paragraph);
        const explicitlyRejects = /\b(?:not vulnerable|no vulnerab|rejected|descartad|false positive|falso positivo|safe|segur[oa]|correct)\b/i
            .test(paragraph);
        if (accusesSafeCode && !explicitlyRejects) {
            fail(`The report labels the ${safeFile} decoy as vulnerable without supporting evidence.`);
        }
    }
    const confirmedHeadings = report.match(/^\s*(?:#{1,6}\s*)?(?:finding|hallazgo)\s+\d+/gim) ?? [];
    if (confirmedHeadings.length > 5) {
        fail('The report exceeded the five-finding evidence budget.');
    }
    if (report.length > 30_000) {
        fail('The report exceeded the bounded-report size.');
    }
} else {
    fail(`Unknown security audit oracle mode: ${mode}`);
}
