/** Plain-text invoice. */
export function formatInvoice(invoice) {
    let subtotal = 0;
    for (const line of invoice.lines) {
        subtotal += line.qty * line.unitPrice;
    }
    const tax = Math.round(subtotal * invoice.taxRate * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    return [
        `INVOICE ${invoice.number}`,
        `Subtotal: ${subtotal.toFixed(2)}`,
        `Tax: ${tax.toFixed(2)}`,
        `Total: ${total.toFixed(2)}`,
    ].join('\n');
}

/** Plain-text quote. */
export function formatQuote(quote) {
    let subtotal = 0;
    for (const line of quote.lines) {
        subtotal += line.qty * line.unitPrice;
    }
    const tax = Math.round(subtotal * quote.taxRate * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    return [
        `QUOTE ${quote.number} (valid until ${quote.validUntil})`,
        `Subtotal: ${subtotal.toFixed(2)}`,
        `Tax: ${tax.toFixed(2)}`,
        `Total: ${total.toFixed(2)}`,
    ].join('\n');
}
