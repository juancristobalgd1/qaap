// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Derives which app routes the visual verification should walk after a UI turn.
 *
 * The agent does not declare an explicit test plan, so the plan is inferred from the
 * evidence the turn left behind: route files edited by write/edit/patch tools (mapped
 * through the common framework conventions) and route-like paths mentioned in the last
 * user/agent messages. The root route is always walked first.
 */

export const MAX_VISUAL_FLOW_STEPS = 3;

interface FlowConversationMessage {
    readonly role?: string;
    readonly content?: string;
    readonly segments?: readonly { readonly type?: string; readonly name?: string; readonly args?: string }[];
}

interface FlowConversation {
    readonly messages?: readonly FlowConversationMessage[];
}

const EDIT_TOOL_RE = /write|edit|patch/i;
/** Candidate route-file paths inside tool args (JSON-escaped or plain). */
const FILE_PATH_RE = /[\w./\\-]+\.(?:tsx|jsx|ts|js|vue|svelte|astro|html?)\b/g;
/** Route-like tokens in prose: absolute, short, no extension. */
const TEXT_ROUTE_RE = /(?:^|[\s(`"'])(\/[a-z0-9][a-z0-9\-_/]*)/gi;
/** Filesystem-ish or backend prefixes that are never app routes. */
const NON_ROUTE_PREFIXES = [
    '/api', '/src', '/app', '/pages', '/public', '/assets', '/node_modules', '/dist', '/build',
    '/home', '/usr', '/workspace', '/tmp', '/var', '/etc', '/opt', '/users', '/qaap',
];

function isNavigableSegment(segment: string): boolean {
    return !!segment
        && !segment.startsWith('[')
        && !segment.startsWith('(')
        && !segment.startsWith('_')
        && !segment.startsWith('+')
        && !segment.startsWith('@')
        && !segment.includes('.');
}

/**
 * Maps an edited file to the route it renders, following the common conventions:
 * Next.js pages router (`pages/checkout.tsx`, `pages/checkout/index.tsx`), Next.js app
 * router (`app/dashboard/page.tsx`), SvelteKit (`src/routes/settings/+page.svelte`),
 * Remix (`app/routes/checkout.tsx`) and Astro/static (`src/pages/pricing.astro`).
 * Dynamic, group, and private segments are not navigable and yield `undefined`.
 */
export function routeFromEditedFile(filePath: string): string | undefined {
    const normalized = filePath.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);

    const collect = (parts: readonly string[]): string | undefined => {
        if (!parts.every(isNavigableSegment)) {
            return undefined;
        }
        const route = `/${parts.join('/')}`;
        return route.startsWith('/api') ? undefined : route;
    };

    const appIndex = segments.lastIndexOf('app');
    if (appIndex >= 0) {
        const rest = segments.slice(appIndex + 1);
        const file = rest[rest.length - 1] ?? '';
        // Next.js app router: only page files render a route.
        if (/^page\.(?:tsx|jsx|ts|js)$/.test(file)) {
            return collect(rest.slice(0, -1)) ?? (rest.length === 1 ? '/' : undefined);
        }
        // Remix flat routes: app/routes/checkout.tsx, app/routes/_index.tsx.
        if (rest[0] === 'routes' && rest.length === 2) {
            const name = file.replace(/\.(?:tsx|jsx|ts|js)$/, '');
            if (name === '_index' || name === 'index') {
                return '/';
            }
            return collect(name.split('.'));
        }
        return undefined;
    }

    const routesIndex = segments.lastIndexOf('routes');
    if (routesIndex >= 0 && segments[routesIndex - 1] === 'src') {
        const rest = segments.slice(routesIndex + 1);
        const file = rest[rest.length - 1] ?? '';
        // SvelteKit: only +page files render a route.
        if (/^\+page(?:@[\w-]*)?\.svelte$/.test(file)) {
            return rest.length === 1 ? '/' : collect(rest.slice(0, -1));
        }
        return undefined;
    }

    const pagesIndex = segments.lastIndexOf('pages');
    if (pagesIndex >= 0) {
        const rest = segments.slice(pagesIndex + 1);
        if (rest.length === 0) {
            return undefined;
        }
        const file = rest[rest.length - 1];
        const name = file.replace(/\.(?:tsx|jsx|ts|js|vue|astro|html?)$/, '');
        if (name === file) {
            return undefined;
        }
        const parts = name === 'index' ? rest.slice(0, -1) : [...rest.slice(0, -1), name];
        if (parts.length === 0) {
            return '/';
        }
        return collect(parts);
    }
    return undefined;
}

/** Route-like paths mentioned in prose, filtered down to plausible app routes. */
export function routesMentionedInText(text: string | undefined): string[] {
    if (!text?.trim()) {
        return [];
    }
    const routes: string[] = [];
    for (const match of text.matchAll(TEXT_ROUTE_RE)) {
        const raw = match[1].replace(/\/+$/, '');
        if (!raw || raw === '/' || raw.length > 40) {
            continue;
        }
        const segments = raw.split('/').filter(Boolean);
        if (segments.length > 3 || !segments.every(isNavigableSegment)) {
            continue;
        }
        const lower = raw.toLowerCase();
        if (NON_ROUTE_PREFIXES.some(prefix => lower === prefix || lower.startsWith(`${prefix}/`))) {
            continue;
        }
        routes.push(lower);
    }
    return routes;
}

/** Routes for the files the turn edited, in edit order. */
function routesFromEditedFiles(conversation: FlowConversation): string[] {
    const routes: string[] = [];
    for (const message of conversation.messages ?? []) {
        for (const segment of message.segments ?? []) {
            if (segment.type !== 'tool' || !EDIT_TOOL_RE.test(segment.name ?? '')) {
                continue;
            }
            for (const file of segment.args?.match(FILE_PATH_RE) ?? []) {
                const route = routeFromEditedFile(file);
                if (route) {
                    routes.push(route);
                }
            }
        }
    }
    return routes;
}

/**
 * The walk plan for a settled turn: always the root, then routes derived from edited
 * route files, then routes mentioned in the last user/agent messages — deduped and
 * capped at {@link MAX_VISUAL_FLOW_STEPS}.
 */
export function deriveVisualFlowSteps(conversation: FlowConversation): string[] {
    const messages = conversation.messages ?? [];
    const lastUser = [...messages].reverse().find(message => message.role === 'user');
    const lastAgent = [...messages].reverse().find(message => message.role === 'agent');
    const candidates = [
        ...routesFromEditedFiles(conversation),
        ...routesMentionedInText(lastUser?.content),
        ...routesMentionedInText(lastAgent?.content),
    ];
    const steps = ['/'];
    for (const route of candidates) {
        if (steps.length >= MAX_VISUAL_FLOW_STEPS) {
            break;
        }
        if (!steps.includes(route)) {
            steps.push(route);
        }
    }
    return steps;
}
