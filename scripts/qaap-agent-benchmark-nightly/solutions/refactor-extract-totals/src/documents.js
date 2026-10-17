import { computeTotals } from './totals.js';

export function formatInvoice(invoice) {
    const { subtotal, tax, total } = computeTotals(invoice.lines, invoice.taxRate);
    return [
        `INVOICE ${invoice.number}`,
        `Subtotal: ${subtotal.toFixed(2)}`,
        `Tax: ${tax.toFixed(2)}`,
        `Total: ${total.toFixed(2)}`,
    ].join('\n');
}

export function formatQuote(quote) {
    const { subtotal, tax, total } = computeTotals(quote.lines, quote.taxRate);
    return [
        `QUOTE ${quote.number} (valid until ${quote.validUntil})`,
        `Subtotal: ${subtotal.toFixed(2)}`,
        `Tax: ${tax.toFixed(2)}`,
        `Total: ${total.toFixed(2)}`,
    ].join('\n');
}
