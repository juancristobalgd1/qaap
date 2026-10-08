// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Docker resource namespace for a Qaap control plane that shares a Docker daemon with another one
 * (staging next to production on the same VPS). Production leaves `QAAP_DOCKER_NAMESPACE` unset, so
 * every name and label stays exactly as before. A namespaced control plane prefixes every container
 * and network it creates, labels them with its namespace, and only discovers resources carrying
 * that same label; an un-namespaced control plane ignores namespaced resources.
 */
export const QAAP_DOCKER_NAMESPACE_LABEL = 'com.qaap.namespace';

const NAMESPACE_PATTERN = /^[a-z][a-z0-9]{0,15}$/;

export function qaapDockerNamespace(env: NodeJS.ProcessEnv = process.env): string {
    const raw = env.QAAP_DOCKER_NAMESPACE?.trim().toLowerCase() ?? '';
    if (!raw) {
        return '';
    }
    if (!NAMESPACE_PATTERN.test(raw)) {
        throw new Error(`QAAP_DOCKER_NAMESPACE "${raw}" must be 1-16 lowercase letters or digits, starting with a letter.`);
    }
    return raw;
}

/** `name` unchanged without a namespace, `<namespace>-<name>` with one. */
export function qaapDockerName(name: string, env: NodeJS.ProcessEnv = process.env): string {
    const namespace = qaapDockerNamespace(env);
    return namespace ? `${namespace}-${name}` : name;
}

/** Labels to add to every resource this control plane creates (none without a namespace). */
export function qaapDockerNamespaceLabels(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
    const namespace = qaapDockerNamespace(env);
    return namespace ? { [QAAP_DOCKER_NAMESPACE_LABEL]: namespace } : {};
}

/** Whether a discovered resource belongs to this control plane's namespace. */
export function isInQaapDockerNamespace(
    labels: Readonly<Record<string, string>> | undefined,
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    return (labels?.[QAAP_DOCKER_NAMESPACE_LABEL] ?? '') === qaapDockerNamespace(env);
}
