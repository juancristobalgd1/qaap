// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AIVariableResolutionRequest } from '@theia/ai-core';
import { ImageContextVariable } from '@theia/ai-chat/lib/common/image-context-variable';
import type { QaapTranscriptUserImagePreview } from '../common/qaap-transcript-user-image-preview';

export function buildTranscriptImagePreviewRequest(wsRelativePath: string): AIVariableResolutionRequest {
    const fileName = wsRelativePath.split('/').pop() ?? wsRelativePath;
    return ImageContextVariable.createPathBasedRequest(wsRelativePath, fileName);
}

export async function resolveTranscriptImagePreviewSrc(
    preview: QaapTranscriptUserImagePreview,
    resolvePreview?: (item: AIVariableResolutionRequest) => Promise<string | undefined>,
): Promise<string | undefined> {
    if (preview.src) {
        return preview.src;
    }
    if (!resolvePreview) {
        return undefined;
    }
    const path = preview.wsRelativePath ?? preview.fileName;
    return resolvePreview(buildTranscriptImagePreviewRequest(path));
}
