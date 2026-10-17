const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad(value) {
    return String(value).padStart(2, '0');
}

/** Parse a calendar day key (`YYYY-MM-DD`) into a Date. */
export function parseDate(key) {
    return new Date(key);
}

/** Format a Date as a calendar day key (`YYYY-MM-DD`). */
export function toDateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Add whole calendar days to a day key and return the new day key. */
export function addDays(key, days) {
    const date = parseDate(key);
    date.setDate(date.getDate() + days);
    return toDateKey(date);
}

/** Whole calendar days from `fromKey` to `toKey` (negative when `toKey` is earlier). */
export function daysBetween(fromKey, toKey) {
    return Math.round((parseDate(toKey) - parseDate(fromKey)) / MS_PER_DAY);
}
