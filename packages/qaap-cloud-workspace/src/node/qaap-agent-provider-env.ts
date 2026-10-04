// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { mustWithholdOperatorProviderCredentials } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { AGENT_ENV_PREFS } from './qaap-agent-task-runner-constants';
import { stripBackendOnlyEnv } from './qaap-child-process-env';

/**
 * Operator-level credentials read by the built-in agent CLIs (see QAAP_BUILTIN_AGENT_DEFINITIONS) that have
 * no Settings mapping in AGENT_ENV_PREFS. None is re-applied per user after stripping, except HF_TOKEN,
 * which is re-derived from the user's own Hugging Face key.
 */
export const SHARED_PROVIDER_ONLY_ENV: readonly string[] = [
    // Hugging Face / Mistral / Groq / DeepSeek (QAIQ, OpenCode, Hermes providers)
    'HF_TOKEN', 'MISTRAL_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY',
    // Grok Build
    'XAI_API_KEY', 'GROK_API_KEY',
    // Codex
    'CODEX_API_KEY',
    // Claude Code / OpenClaude (subscription token, gateway, Bedrock credentials)
    'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_BEARER_TOKEN_BEDROCK',
    // Gemini / Antigravity service account
    'GOOGLE_APPLICATION_CREDENTIALS',
    // Cursor Agent
    'CURSOR_API_KEY',
    // Copilot CLI. INVARIANT: agents never receive the user's GitHub token, in env, file, helper or
    // otherwise; hosted pushes use it only inside the root backend (doc/qaap-github-token-boundary.md).
    'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN',
    // Qwen Code / Kimi CLI / Hermes (Nous)
    'DASHSCOPE_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_API_KEY', 'NOUS_API_KEY',
];

/**
 * Removes inherited backend env the agent must not see. Backend-only secrets are always removed. Operator
 * provider credentials are removed for authenticated tenants and for every owner on a multi-user backend
 * ({@link mustWithholdOperatorProviderCredentials}): per-user Settings are then their sole source. Local
 * single-user runs keep the operator's keys (they are the operator).
 */
export function stripSharedProviderEnv(env: NodeJS.ProcessEnv, ownerLogin?: string): void {
    if (mustWithholdOperatorProviderCredentials(ownerLogin)) {
        for (const mapping of AGENT_ENV_PREFS) {
            delete env[mapping.env];
        }
        for (const name of SHARED_PROVIDER_ONLY_ENV) {
            delete env[name];
        }
        // Also strip compat-derived keys that would short-circuit per-user resolution.
        delete env.OPENAI_BASE_URL;
        delete env.CLAUDE_CODE_USE_OPENAI;
        delete env.NVIDIA_NIM;
    }
    // Backend-only secrets the agent never needs. Without this the child inherits them via
    // {...process.env}, so any user could exfiltrate them with `env | grep -i secret`: the OAuth
    // client secret enables app impersonation, and the VAPID private key lets it forge Web Push
    // to other users. Deleting them here (the single spawn-env chokepoint) closes SEC-3.
    stripBackendOnlyEnv(env);
}
