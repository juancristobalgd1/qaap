// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Normalized kind of a tool call made by a coding-agent harness. Harness adapters map their own
 * tool names onto this set so the tool gate and the capability registry can reason about them.
 */
export type QaapToolKind = 'shell' | 'edit' | 'write' | 'read' | 'web' | 'mcp' | 'other';
