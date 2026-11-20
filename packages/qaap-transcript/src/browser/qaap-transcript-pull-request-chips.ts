// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Turns pull request mentions in a SETTLED agent text block into inline chips (GitHub glyph +
// "#117"). It runs once per block when its markdown is applied, never per streaming tick, and
// uses bounded regular expressions. Clicking a chip is wired by the markdown link handler.

import type { WorkHubTranscriptPullRequestRef } from '@theia/qaap-transcript-overlay/lib/browser/work-hub-transcript-bridge';

export const TRANSCRIPT_PULL_REQUEST_CHIP_CLASS = 'qaap-transcript-pr-chip';

/** The conversation's GitHub repository, when it has one. Bare `#n` references need it. */
export interface TranscriptPullRequestRepo {
    readonly owner: string;
    readonly name: string;
}

const PULL_REQUEST_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/pull\/(\d{1,7})(?:[/?#][^\s]*)?$/;
/** `#n`, optionally introduced by "PR" or "pull request". Not preceded by a word character, `/`, `&` or `#`. */
const PULL_REQUEST_NUMBER = /(?<![\w/&#[])((?:PR|pull request)\s+)?#(\d{1,7})(?![\w-])/gi;
const ISSUE_BEFORE = /\bissues?\s*$/i;
const COLOR_BEFORE = /\b(?:colou?rs?|hex|rgba?|background|fill|stroke|border)\b[^.\n]{0,24}$/i;
const SKIPPED_ANCESTORS = 'code, pre, a, button, kbd, samp, script, style, h1, h2, h3, h4, h5, h6, textarea';
/** Hex colors written with decimal digits only are 6 or 8 long (`#123456`); PR numbers never get there. */
const HEX_COLOR_DIGIT_COUNTS: ReadonlySet<number> = new Set([6, 8]);

/** The pull request a GitHub pull URL points to. */
export function parseTranscriptPullRequestUrl(href: string): WorkHubTranscriptPullRequestRef | undefined {
    const match = PULL_REQUEST_URL.exec(href.trim());
    if (!match) {
        return undefined;
    }
    return { owner: match[1], repo: match[2], number: Number(match[3]), url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` };
}

/** `#117` for the conversation's own repository, `owner/repo#117` for any other. */
export function transcriptPullRequestChipLabel(ref: WorkHubTranscriptPullRequestRef, repo: TranscriptPullRequestRepo | undefined): string {
    const own = !!repo && repo.owner.toLowerCase() === ref.owner.toLowerCase() && repo.name.toLowerCase() === ref.repo.toLowerCase();
    return own ? `#${ref.number}` : `${ref.owner}/${ref.repo}#${ref.number}`;
}

/** One bare reference found in plain text: where it sits and which number it names. */
export interface TranscriptPullRequestTextMatch {
    readonly index: number;
    readonly length: number;
    readonly number: number;
}

/**
 * Bare `#n` / `PR #n` / `pull request #n` references in one text run. Skips issue references
 * ("issue #4"), decimal-only hex colors and numbers beside colour words. Code, headings and
 * links are the caller's business (it only passes prose text nodes).
 */
export function findTranscriptPullRequestTextMatches(text: string): TranscriptPullRequestTextMatch[] {
    if (!text.includes('#')) {
        return [];
    }
    const matches: TranscriptPullRequestTextMatch[] = [];
    PULL_REQUEST_NUMBER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PULL_REQUEST_NUMBER.exec(text)) !== null) {
        const prefix = match[1];
        const digits = match[2];
        const before = text.slice(Math.max(0, match.index - 40), match.index);
        if (!prefix && ISSUE_BEFORE.test(before)) {
            continue;
        }
        if (!prefix && (HEX_COLOR_DIGIT_COUNTS.has(digits.length) || COLOR_BEFORE.test(before))) {
            continue;
        }
        const number = Number(digits);
        if (number < 1) {
            continue;
        }
        matches.push({ index: match.index, length: match[0].length, number });
    }
    return matches;
}

/** Builds the chip anchor. It keeps a real `href`, so Copy Link and middle click still work. */
export function createTranscriptPullRequestChip(
    doc: Document,
    ref: WorkHubTranscriptPullRequestRef,
    repo: TranscriptPullRequestRepo | undefined,
    title?: string,
): HTMLAnchorElement {
    const chip = doc.createElement('a');
    chip.className = TRANSCRIPT_PULL_REQUEST_CHIP_CLASS;
    chip.href = ref.url;
    chip.dataset.prOwner = ref.owner;
    chip.dataset.prRepo = ref.repo;
    chip.dataset.prNumber = String(ref.number);
    chip.title = title ?? `${ref.owner}/${ref.repo}#${ref.number}`;
    const icon = doc.createElement('span');
    icon.className = 'codicon codicon-github qaap-transcript-pr-chip-icon';
    icon.setAttribute('aria-hidden', 'true');
    const label = doc.createElement('span');
    label.className = 'qaap-transcript-pr-chip-label';
    label.textContent = transcriptPullRequestChipLabel(ref, repo);
    chip.append(icon, label);
    return chip;
}

/** The pull request a chip stands for, read back from its data attributes. */
export function readTranscriptPullRequestChip(element: Element | null): WorkHubTranscriptPullRequestRef | undefined {
    const chip = element?.closest<HTMLElement>(`.${TRANSCRIPT_PULL_REQUEST_CHIP_CLASS}`);
    const { prOwner, prRepo, prNumber } = chip?.dataset ?? {};
    const number = Number(prNumber);
    if (!chip || !prOwner || !prRepo || !Number.isInteger(number) || number < 1) {
        return undefined;
    }
    return { owner: prOwner, repo: prRepo, number, url: `https://github.com/${prOwner}/${prRepo}/pull/${number}` };
}

/**
 * Replaces pull request mentions under `root` by chips: links to GitHub pull URLs (autolinked or
 * markdown links) and, when `repo` is known, bare `#n` references in prose. Returns how many
 * chips were made. Call once per settled block.
 */
export function decorateTranscriptPullRequestChips(root: HTMLElement, repo: TranscriptPullRequestRepo | undefined): number {
    const doc = root.ownerDocument;
    let count = 0;
    for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="github.com/"]'))) {
        const ref = parseTranscriptPullRequestUrl(anchor.getAttribute('href') ?? '');
        if (!ref || anchor.closest(`.${TRANSCRIPT_PULL_REQUEST_CHIP_CLASS}`)) {
            continue;
        }
        const text = anchor.textContent?.trim() ?? '';
        const custom = text && text !== anchor.getAttribute('href') && !PULL_REQUEST_URL.test(text) ? text : undefined;
        anchor.replaceWith(createTranscriptPullRequestChip(doc, ref, repo, custom));
        count++;
    }
    if (!repo || !(root.textContent ?? '').includes('#')) {
        return count;
    }
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        if (text.data.includes('#') && !text.parentElement?.closest(SKIPPED_ANCESTORS)) {
            nodes.push(text);
        }
    }
    for (const node of nodes) {
        const matches = findTranscriptPullRequestTextMatches(node.data);
        if (!matches.length) {
            continue;
        }
        const fragment = doc.createDocumentFragment();
        let cursor = 0;
        for (const match of matches) {
            fragment.append(node.data.slice(cursor, match.index));
            const ref: WorkHubTranscriptPullRequestRef = {
                owner: repo.owner,
                repo: repo.name,
                number: match.number,
                url: `https://github.com/${repo.owner}/${repo.name}/pull/${match.number}`,
            };
            fragment.append(createTranscriptPullRequestChip(doc, ref, repo));
            cursor = match.index + match.length;
            count++;
        }
        fragment.append(node.data.slice(cursor));
        node.replaceWith(fragment);
    }
    return count;
}
