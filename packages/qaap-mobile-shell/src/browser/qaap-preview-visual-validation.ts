// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapPreviewVisualValidationResult } from '../common/qaap-visual-verification';

function hasAccessibleName(element: Element): boolean {
    return !!(
        element.getAttribute('aria-label')?.trim()
        || element.getAttribute('aria-labelledby')?.trim()
        || element.getAttribute('title')?.trim()
        || element.textContent?.trim()
    );
}

function inputHasLabel(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, doc: Document): boolean {
    if (input.getAttribute('aria-label')?.trim() || input.getAttribute('aria-labelledby')?.trim()) {
        return true;
    }
    if (input.closest('label')) {
        return true;
    }
    const id = input.id.trim();
    return !!id && [...doc.querySelectorAll('label[for]')].some(label => label.getAttribute('for') === id);
}

const QAAP_PREVIEW_PROXY_FAILURES = new Set([
    'This preview belongs to another execution.',
    'This preview port belongs to another workspace.',
    'Cannot proxy the Qaap IDE port. Use a different dev-server port.',
]);

/** True when the iframe rendered Qaap's fail-closed proxy response instead of the project app. */
export function qaapPreviewDocumentIsProxyFailure(doc: Document): boolean {
    const bodyText = doc.body?.innerText?.trim() ?? doc.body?.textContent?.trim() ?? '';
    return QAAP_PREVIEW_PROXY_FAILURES.has(bodyText);
}

/** Fast same-origin DOM smoke check run immediately before screenshot capture. */
export function validateQaapPreviewDocument(
    doc: Document,
    frame: Pick<HTMLIFrameElement, 'clientWidth'>,
): QaapPreviewVisualValidationResult {
    const issues: string[] = [];
    const bodyText = doc.body?.innerText?.trim() ?? doc.body?.textContent?.trim() ?? '';
    if (bodyText.length < 20) {
        issues.push('The page appears empty or contains very little visible text.');
    }
    if (!doc.querySelector('h1')) {
        issues.push('No primary page heading (h1) was found.');
    }
    const brokenImages = [...doc.images].filter(image => image.complete && image.naturalWidth === 0);
    if (brokenImages.length > 0) {
        issues.push(`${brokenImages.length} image${brokenImages.length === 1 ? '' : 's'} failed to load.`);
    }
    const unnamedButtons = [...doc.querySelectorAll('button, [role="button"]')].filter(button => !hasAccessibleName(button));
    if (unnamedButtons.length > 0) {
        issues.push(`${unnamedButtons.length} button${unnamedButtons.length === 1 ? '' : 's'} lack an accessible name.`);
    }
    const unlabeledInputs = [...doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')]
        .filter(input => input.type !== 'hidden' && !inputHasLabel(input, doc));
    if (unlabeledInputs.length > 0) {
        issues.push(`${unlabeledInputs.length} form control${unlabeledInputs.length === 1 ? '' : 's'} lack a label.`);
    }
    const viewportWidth = frame.clientWidth || doc.documentElement.clientWidth;
    if (viewportWidth > 0 && doc.documentElement.scrollWidth > viewportWidth + 2) {
        issues.push('The page has horizontal overflow at the captured viewport width.');
    }
    const interactiveCount = doc.querySelectorAll('a, button, input, textarea, select, [role="button"]').length;
    return {
        status: issues.length === 0 ? 'passed' : 'warning',
        summary: issues.length === 0
            ? `Preview loaded and passed the DOM smoke check (${interactiveCount} interactive elements).`
            : `Preview loaded with ${issues.length} visual/accessibility finding${issues.length === 1 ? '' : 's'}.`,
        issues,
    };
}
