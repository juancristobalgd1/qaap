/** Parse CSV text into rows of string fields. */
export function parseCsv(text) {
    return text
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => line.split(','));
}

/** Serialize rows of string fields as CSV text (newline separated, trailing newline). */
export function toCsv(rows) {
    return `${rows.map(row => row.join(',')).join('\n')}\n`;
}
