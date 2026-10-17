export function computeTotals(lines, taxRate) {
    let subtotal = 0;
    for (const line of lines) {
        subtotal += line.qty * line.unitPrice;
    }
    const tax = Math.round(subtotal * taxRate * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    return { subtotal, tax, total };
}
