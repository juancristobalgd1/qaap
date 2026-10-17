const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad(value) {
    return String(value).padStart(2, '0');
}

export function parseDate(key) {
    return new Date(`${key}T00:00:00Z`);
}

export function toDateKey(date) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(key, days) {
    const date = parseDate(key);
    date.setUTCDate(date.getUTCDate() + days);
    return toDateKey(date);
}

export function daysBetween(fromKey, toKey) {
    return Math.round((parseDate(toKey) - parseDate(fromKey)) / MS_PER_DAY);
}
