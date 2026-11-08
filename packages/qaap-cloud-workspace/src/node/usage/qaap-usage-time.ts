// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Calendar arithmetic in an IANA timezone, so that daily buckets follow the user's local midnight. */
export namespace QaapUsageTime {

    const formatters = new Map<string, Intl.DateTimeFormat>();

    export const HOUR = HOUR_MS;

    /** Whether `timeZone` is an IANA name the runtime understands. */
    export function isValidTimeZone(timeZone: string): boolean {
        try {
            formatter(timeZone);
            return true;
        } catch {
            return false;
        }
    }

    /** The server's own timezone, or UTC when the runtime cannot tell. */
    export function defaultTimeZone(): string {
        const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return resolved && isValidTimeZone(resolved) ? resolved : 'UTC';
    }

    /** `YYYY-MM-DD` of the local calendar day that contains `ms`. */
    export function localDateKey(ms: number, timeZone: string): string {
        const parts = wallClock(ms, timeZone);
        return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
    }

    /** The date key `days` days after `dateKey` (negative values go back). */
    export function addDays(dateKey: string, days: number): string {
        const [year, month, day] = dateKey.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
    }

    /** Epoch milliseconds of local midnight that starts the day `dateKey`. */
    export function startOfLocalDay(dateKey: string, timeZone: string): number {
        const [year, month, day] = dateKey.split('-').map(Number);
        const wallAsUtc = Date.UTC(year, month - 1, day);
        let instant = wallAsUtc;
        // Two passes settle the offset even when the zone changes it on that day.
        for (let pass = 0; pass < 2; pass++) {
            instant = wallAsUtc - zoneOffsetMs(instant, timeZone);
        }
        return instant;
    }

    /** Start of the hour that contains `ms`. Hours are whole UTC hours, which every timezone shares. */
    export function startOfHour(ms: number): number {
        return Math.floor(ms / HOUR_MS) * HOUR_MS;
    }

    function zoneOffsetMs(ms: number, timeZone: string): number {
        const parts = wallClock(ms, timeZone);
        const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
        return asUtc - Math.floor(ms / 1000) * 1000;
    }

    function wallClock(ms: number, timeZone: string): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number> {
        const values: Record<string, number> = {};
        for (const part of formatter(timeZone).formatToParts(ms)) {
            if (part.type !== 'literal') {
                values[part.type] = Number(part.value);
            }
        }
        return {
            year: values.year,
            month: values.month,
            day: values.day,
            hour: values.hour % 24,
            minute: values.minute,
            second: values.second,
        };
    }

    function formatter(timeZone: string): Intl.DateTimeFormat {
        let cached = formatters.get(timeZone);
        if (!cached) {
            cached = new Intl.DateTimeFormat('en-US', {
                timeZone,
                hourCycle: 'h23',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            formatters.set(timeZone, cached);
        }
        return cached;
    }

    function pad(value: number): string {
        return value < 10 ? `0${value}` : `${value}`;
    }
}
