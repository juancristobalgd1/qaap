/** Count lines (newline characters), whitespace separated words and characters. */
export function countText(text) {
    const lines = (text.match(/\n/g) ?? []).length;
    const words = text.split(/\s+/).filter(Boolean).length;
    return { lines, words, chars: text.length };
}
