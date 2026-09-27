// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const COMPOSER_SKILL_DISPLAY_MARKER_PREFIX = '<!-- qaap-composer-skill-display ';
const COMPOSER_SKILL_DISPLAY_MARKER_SUFFIX = ' -->';

export interface ComposerSkillDisplayMetadata {
    readonly skillName: string;
    readonly prefix?: string;
    readonly userText?: string;
}

export function createComposerSkillDisplayMarker(metadata: ComposerSkillDisplayMetadata): string {
    const encoded = encodeURIComponent(JSON.stringify(metadata)).replace(/-/g, '%2D');
    return `${COMPOSER_SKILL_DISPLAY_MARKER_PREFIX}${encoded}${COMPOSER_SKILL_DISPLAY_MARKER_SUFFIX}`;
}

export function parseComposerSkillDisplayMarker(text: string): ComposerSkillDisplayMetadata | undefined {
    const trimmedStart = text.trimStart();
    if (!trimmedStart.startsWith(COMPOSER_SKILL_DISPLAY_MARKER_PREFIX)) {
        return undefined;
    }
    const end = trimmedStart.indexOf(COMPOSER_SKILL_DISPLAY_MARKER_SUFFIX);
    if (end < 0) {
        return undefined;
    }
    const encoded = trimmedStart.slice(COMPOSER_SKILL_DISPLAY_MARKER_PREFIX.length, end);
    try {
        const parsed = JSON.parse(decodeURIComponent(encoded)) as Partial<ComposerSkillDisplayMetadata>;
        if (typeof parsed.skillName !== 'string' || !parsed.skillName.trim()) {
            return undefined;
        }
        return {
            skillName: parsed.skillName.trim(),
            prefix: typeof parsed.prefix === 'string' ? parsed.prefix.trim() : undefined,
            userText: typeof parsed.userText === 'string' ? parsed.userText.trim() : undefined,
        };
    } catch {
        return undefined;
    }
}
