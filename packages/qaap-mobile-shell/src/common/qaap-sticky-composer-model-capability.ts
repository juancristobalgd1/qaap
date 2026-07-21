// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { hashString } from './qaap-agent-task-client';

export const CAPABILITY_LEVELS = [
    { value: 0, id: 'light', label: nls.localize('qaap/mobileProjects/capabilityLight', 'Light') },
    { value: 1, id: 'standard', label: nls.localize('qaap/mobileProjects/capabilityStandard', 'Standard') },
    { value: 2, id: 'deep', label: nls.localize('qaap/mobileProjects/capabilityDeep', 'Deep') },
    { value: 3, id: 'max', label: nls.localize('qaap/mobileProjects/capabilityMax', 'Max') },
] as const;

export type ModelCapabilityLevelId = typeof CAPABILITY_LEVELS[number]['id'];
export type ModelCapabilityLevelValue = typeof CAPABILITY_LEVELS[number]['value'];

const CAPABILITY_LEVEL_BY_ID = new Map<string, ModelCapabilityLevelValue>(
    CAPABILITY_LEVELS.map(level => [level.id, level.value]),
);
const CAPABILITY_LEVEL_BY_VALUE = new Map<ModelCapabilityLevelValue, typeof CAPABILITY_LEVELS[number]>(
    CAPABILITY_LEVELS.map(level => [level.value, level]),
);

const SELECTED_CAPABILITY_STORAGE_KEY = 'qaap.mobile.projects.modelCapabilityLevel';
/** Pre-release builds persisted under this key — keep reading it. */
const LEGACY_CAPABILITY_STORAGE_KEY = 'qaap.mobile.projects.codexModelCapability';

const LEGACY_REASONING_TO_CAPABILITY: Readonly<Record<string, ModelCapabilityLevelValue>> = {
    off: 0,
    minimal: 0,
    low: 0,
    medium: 1,
    standard: 1,
    high: 2,
    deep: 2,
    auto: 2,
    max: 3,
    maximum: 3,
};

export const DEFAULT_MODEL_CAPABILITY_LEVEL: ModelCapabilityLevelValue = 1;

export function scopedModelCapabilityStorageKey(cwd: string): string {
    return `${SELECTED_CAPABILITY_STORAGE_KEY}.${hashString(cwd)}`;
}

function scopedLegacyModelCapabilityStorageKey(cwd: string): string {
    return `${LEGACY_CAPABILITY_STORAGE_KEY}.${hashString(cwd)}`;
}

export function isModelCapabilityLevelValue(value: number | undefined): value is ModelCapabilityLevelValue {
    return value === 0 || value === 1 || value === 2 || value === 3;
}

export function clampModelCapabilityLevel(value: number): ModelCapabilityLevelValue {
    if (value <= 0) {
        return 0;
    }
    if (value >= 3) {
        return 3;
    }
    return value as ModelCapabilityLevelValue;
}

export function resolveCapabilityLevelConfig(value: ModelCapabilityLevelValue): typeof CAPABILITY_LEVELS[number] {
    return CAPABILITY_LEVEL_BY_VALUE.get(value) ?? CAPABILITY_LEVEL_BY_VALUE.get(DEFAULT_MODEL_CAPABILITY_LEVEL)!;
}

export function resolveCapabilityLevelLabel(value: ModelCapabilityLevelValue): string {
    return resolveCapabilityLevelConfig(value).label;
}

export function resolveCapabilityLevelById(id: string | undefined): ModelCapabilityLevelValue | undefined {
    if (!id) {
        return undefined;
    }
    const normalized = id.trim().toLowerCase();
    const direct = CAPABILITY_LEVEL_BY_ID.get(normalized);
    if (direct !== undefined) {
        return direct;
    }
    const legacy = LEGACY_REASONING_TO_CAPABILITY[normalized];
    return legacy;
}

export function parseStoredModelCapabilityLevel(raw: string | null | undefined): ModelCapabilityLevelValue | undefined {
    if (!raw) {
        return undefined;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        return undefined;
    }
    const numeric = Number(trimmed);
    if (Number.isInteger(numeric) && isModelCapabilityLevelValue(numeric)) {
        return numeric;
    }
    return resolveCapabilityLevelById(trimmed);
}

export function readStoredModelCapabilityLevel(cwd: string | undefined): ModelCapabilityLevelValue | undefined {
    if (!cwd) {
        return undefined;
    }
    try {
        const scopedKey = scopedModelCapabilityStorageKey(cwd);
        const scopedRaw = window.localStorage.getItem(scopedKey)
            ?? window.localStorage.getItem(scopedLegacyModelCapabilityStorageKey(cwd));
        const parsed = parseStoredModelCapabilityLevel(scopedRaw);
        if (parsed !== undefined) {
            return parsed;
        }
        if (scopedRaw) {
            window.localStorage.removeItem(scopedKey);
            window.localStorage.removeItem(scopedLegacyModelCapabilityStorageKey(cwd));
        }
        return undefined;
    } catch {
        return undefined;
    }
}

export function writeStoredModelCapabilityLevel(cwd: string | undefined, level: ModelCapabilityLevelValue): void {
    if (!cwd) {
        return;
    }
    const config = resolveCapabilityLevelConfig(level);
    try {
        const serialized = String(config.value);
        window.localStorage.setItem(scopedModelCapabilityStorageKey(cwd), serialized);
        window.localStorage.setItem(scopedLegacyModelCapabilityStorageKey(cwd), config.id);
    } catch {
        /* localStorage unavailable */
    }
}

export function reconcileModelCapabilityLevel(
    current: number | undefined,
    cwd: string | undefined,
): ModelCapabilityLevelValue {
    if (isModelCapabilityLevelValue(current)) {
        return current;
    }
    const stored = readStoredModelCapabilityLevel(cwd);
    if (stored !== undefined) {
        return stored;
    }
    return DEFAULT_MODEL_CAPABILITY_LEVEL;
}

/** Fraction along the track for discrete mark / thumb placement (0…1). */
export function modelCapabilityLevelFraction(value: ModelCapabilityLevelValue): number {
    if (CAPABILITY_LEVELS.length <= 1) {
        return 0;
    }
    return value / (CAPABILITY_LEVELS.length - 1);
}

/** Snap a pointer fraction to the nearest discrete level. */
export function snapModelCapabilityFraction(fraction: number): ModelCapabilityLevelValue {
    const clamped = Math.max(0, Math.min(1, fraction));
    const scaled = clamped * (CAPABILITY_LEVELS.length - 1);
    return clampModelCapabilityLevel(Math.round(scaled));
}
