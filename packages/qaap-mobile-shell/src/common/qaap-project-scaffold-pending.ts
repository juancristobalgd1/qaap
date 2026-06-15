// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const SCAFFOLD_TEMPLATE_KEY = 'qaap.projectScaffold.templateId';
const PENDING_COMPOSER_DRAFT_KEY = 'qaap.projectScaffold.pendingComposerDraft';

export function markQaapProjectScaffoldOnOpen(templateId: string): void {
    if (typeof sessionStorage === 'undefined') {
        return;
    }
    sessionStorage.setItem(SCAFFOLD_TEMPLATE_KEY, templateId);
}

export function peekQaapProjectScaffoldOnOpen(): string | undefined {
    if (typeof sessionStorage === 'undefined') {
        return undefined;
    }
    const value = sessionStorage.getItem(SCAFFOLD_TEMPLATE_KEY)?.trim();
    return value || undefined;
}

export function clearQaapProjectScaffoldOnOpen(): void {
    if (typeof sessionStorage === 'undefined') {
        return;
    }
    sessionStorage.removeItem(SCAFFOLD_TEMPLATE_KEY);
}

export function stageQaapPendingComposerDraft(draft: string): void {
    if (typeof sessionStorage === 'undefined' || !draft.trim()) {
        return;
    }
    sessionStorage.setItem(PENDING_COMPOSER_DRAFT_KEY, draft);
}

export function consumeQaapPendingComposerDraft(): string | undefined {
    if (typeof sessionStorage === 'undefined') {
        return undefined;
    }
    const draft = sessionStorage.getItem(PENDING_COMPOSER_DRAFT_KEY)?.trim();
    sessionStorage.removeItem(PENDING_COMPOSER_DRAFT_KEY);
    return draft || undefined;
}
