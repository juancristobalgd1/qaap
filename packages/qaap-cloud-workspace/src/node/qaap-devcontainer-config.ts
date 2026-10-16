// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The subset of `devcontainer.json` a per-task sandbox honors (doc/qaap-task-sandbox.md).
 * Everything else (features, mounts, runArgs, lifecycle hooks other than postCreateCommand)
 * is ignored on purpose: it either needs host privileges or cannot fit the 30 s startup budget.
 */
export interface QaapDevcontainerConfig {
    /** Absolute path of the devcontainer.json that was read. */
    readonly configPath: string;
    readonly image?: string;
    readonly build?: {
        /** Absolute Dockerfile path. */
        readonly dockerfile: string;
        /** Absolute build context. */
        readonly context: string;
        readonly args: Readonly<Record<string, string>>;
        readonly target?: string;
    };
    readonly containerEnv: Readonly<Record<string, string>>;
    /** Set on every exec (devcontainer `remoteEnv`). */
    readonly remoteEnv: Readonly<Record<string, string>>;
    readonly forwardPorts: readonly number[];
    /** Shell command run once, right after the sandbox container is created. */
    readonly postCreateCommand?: string;
    /** Raw file text, part of the image cache key. */
    readonly source: string;
}

/** How a sandbox gets its image. */
export type QaapTaskSandboxImagePlan =
    | { readonly kind: 'base'; readonly image: string }
    | { readonly kind: 'image'; readonly image: string; readonly devcontainer: QaapDevcontainerConfig }
    | {
        readonly kind: 'build';
        /** Content-addressed tag: the same Dockerfile, context files list and args reuse one build. */
        readonly image: string;
        readonly devcontainer: QaapDevcontainerConfig;
    };

/** Locations the devcontainer spec allows, in lookup order. */
const DEVCONTAINER_CANDIDATES = ['.devcontainer/devcontainer.json', '.devcontainer.json'];

/**
 * Reads a repository's devcontainer definition and turns it into a sandbox image plan.
 * Exposed as a class (not functions) so adopters can rebind it.
 */
@injectable()
export class QaapDevcontainerResolver {

    /** The devcontainer config of `root`, or undefined when the repo has none (or it is unusable). */
    read(root: string): QaapDevcontainerConfig | undefined {
        for (const candidate of DEVCONTAINER_CANDIDATES) {
            const configPath = path.join(root, candidate);
            let source: string;
            try {
                source = fs.readFileSync(configPath, 'utf8');
            } catch {
                continue;
            }
            let raw: unknown;
            try {
                raw = JSON.parse(QaapDevcontainerResolver.stripJsonc(source));
            } catch (error) {
                console.warn(`[qaap-task-sandbox] ignoring unparsable ${configPath}: ${(error as Error).message}`);
                return undefined;
            }
            return this.normalize(raw, configPath, root, source);
        }
        return undefined;
    }

    plan(root: string, baseImage: string): QaapTaskSandboxImagePlan {
        const devcontainer = this.read(root);
        if (!devcontainer) {
            return { kind: 'base', image: baseImage };
        }
        if (devcontainer.build) {
            return { kind: 'build', image: this.buildTag(devcontainer), devcontainer };
        }
        if (devcontainer.image) {
            return { kind: 'image', image: devcontainer.image, devcontainer };
        }
        return { kind: 'base', image: baseImage };
    }

    /** `qaap-devcontainer:<sha>` over the config, the Dockerfile and the build args. */
    buildTag(devcontainer: QaapDevcontainerConfig): string {
        const hash = crypto.createHash('sha256');
        hash.update(devcontainer.source);
        if (devcontainer.build) {
            try {
                hash.update(fs.readFileSync(devcontainer.build.dockerfile));
            } catch {
                hash.update('missing-dockerfile');
            }
            hash.update(JSON.stringify([Object.entries(devcontainer.build.args).sort(), devcontainer.build.target ?? '']));
        }
        return `qaap-devcontainer:${hash.digest('hex').slice(0, 16)}`;
    }

    protected normalize(raw: unknown, configPath: string, root: string, source: string): QaapDevcontainerConfig | undefined {
        if (!raw || typeof raw !== 'object') {
            return undefined;
        }
        const value = raw as Record<string, unknown>;
        const ignored = QaapDevcontainerResolver.IGNORED_KEYS.filter(key => value[key] !== undefined);
        if (ignored.length) {
            console.warn(`[qaap-task-sandbox] ${configPath}: ignoring ${ignored.join(', ')} (not supported in task sandboxes)`);
        }
        const configDir = path.dirname(configPath);
        const inside = (candidate: string): string | undefined => {
            const resolved = path.resolve(configDir, candidate);
            const relative = path.relative(root, resolved);
            // A build context or Dockerfile outside the repository would read host files into the image.
            return relative.startsWith('..') || path.isAbsolute(relative) ? undefined : resolved;
        };
        const build = typeof value.build === 'object' && value.build ? value.build as Record<string, unknown> : undefined;
        const dockerfileName = typeof build?.dockerfile === 'string' ? build.dockerfile
            : typeof value.dockerFile === 'string' ? value.dockerFile : undefined;
        let normalizedBuild: QaapDevcontainerConfig['build'];
        if (dockerfileName) {
            const dockerfile = inside(dockerfileName);
            const context = inside(typeof build?.context === 'string' ? build.context : '.');
            if (!dockerfile || !context) {
                console.warn(`[qaap-task-sandbox] ignoring ${configPath}: build paths leave the repository`);
                return undefined;
            }
            normalizedBuild = {
                dockerfile, context,
                args: QaapDevcontainerResolver.stringRecord(build?.args),
                target: typeof build?.target === 'string' && build.target.trim() ? build.target.trim() : undefined,
            };
        }
        const forwardPorts = Array.isArray(value.forwardPorts)
            ? value.forwardPorts.filter((port): port is number => Number.isInteger(port) && port > 0 && port < 65536)
            : [];
        const postCreateCommand = QaapDevcontainerResolver.lifecycleCommand(value.postCreateCommand);
        return {
            configPath,
            image: typeof value.image === 'string' && value.image.trim() ? value.image.trim() : undefined,
            build: normalizedBuild,
            containerEnv: QaapDevcontainerResolver.stringRecord(value.containerEnv),
            remoteEnv: QaapDevcontainerResolver.stringRecord(value.remoteEnv),
            forwardPorts,
            postCreateCommand: postCreateCommand?.trim() || undefined,
            source,
        };
    }
}

export namespace QaapDevcontainerResolver {

    /**
     * Keys a sandbox never honors: `initializeCommand` runs on the HOST, the run/security keys would
     * grant privileges, and features/compose/mounts/users need tooling or access outside the budget.
     */
    export const IGNORED_KEYS = [
        'initializeCommand', 'runArgs', 'privileged', 'capAdd', 'securityOpt', 'init',
        'features', 'dockerComposeFile', 'service', 'mounts', 'workspaceMount', 'workspaceFolder',
        'remoteUser', 'containerUser', 'onCreateCommand', 'updateContentCommand', 'postStartCommand', 'postAttachCommand',
    ];

    export function stringRecord(value: unknown): Record<string, string> {
        const result: Record<string, string> = {};
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const [key, entry] of Object.entries(value)) {
                if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean')) {
                    result[key] = String(entry);
                }
            }
        }
        return result;
    }

    /** A devcontainer lifecycle command as one shell line: string, argv array, or object of commands run in parallel. */
    export function lifecycleCommand(value: unknown): string | undefined {
        const quote = (part: string): string => `'${part.replace(/'/g, '\'\\\'\'')}'`;
        const single = (entry: unknown): string | undefined => typeof entry === 'string' ? entry.trim() || undefined
            : Array.isArray(entry) && entry.length && entry.every(part => typeof part === 'string') ? entry.map(quote).join(' ')
                : undefined;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const commands = Object.values(value).map(single).filter((entry): entry is string => !!entry);
            return commands.length ? `${commands.map(command => `( ${command} ) &`).join(' ')} wait` : undefined;
        }
        return single(value);
    }

    /** Removes `//` and `/* *\/` comments and trailing commas outside strings (devcontainer.json is JSONC). */
    export function stripJsonc(text: string): string {
        let out = '';
        let inString = false;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (inString) {
                out += char;
                if (char === '\\') {
                    out += text[++i] ?? '';
                } else if (char === '"') {
                    inString = false;
                }
                continue;
            }
            if (char === '"') {
                inString = true;
                out += char;
            } else if (char === '/' && text[i + 1] === '/') {
                while (i < text.length && text[i] !== '\n') {
                    i++;
                }
                out += '\n';
            } else if (char === '/' && text[i + 1] === '*') {
                const end = text.indexOf('*/', i + 2);
                i = end === -1 ? text.length : end + 1;
            } else {
                out += char;
            }
        }
        // Trailing commas before } or ] (strings were preserved above, so this only sees structure
        // plus string contents; restrict to commas followed by whitespace and a closer).
        return out.replace(/,(\s*[}\]])/g, '$1');
    }
}
