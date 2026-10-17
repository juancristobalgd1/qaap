import { assert, oracle } from './_lib.mjs';

// Golden reference: the behaviour that existed before the refactor.
function golden(lines, taxRate) {
    let subtotal = 0;
    for (const line of lines) {
        subtotal += line.qty * line.unitPrice;
    }
    const tax = Math.round(subtotal * taxRate * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    return { subtotal, tax, total };
}

const cases = [
    { lines: [], taxRate: 0 },
    { lines: [{ qty: 1, unitPrice: 0.1 }, { qty: 3, unitPrice: 0.2 }], taxRate: 0.07 },
    { lines: [{ qty: 2, unitPrice: 9.99 }, { qty: 1, unitPrice: 5 }], taxRate: 0.1 },
    { lines: [{ qty: 7, unitPrice: 19.95 }], taxRate: 0.0825 },
    { lines: [{ qty: 1, unitPrice: 1e6 + 0.01 }], taxRate: 0.21 },
    { lines: [{ qty: 3, unitPrice: 33.335 }], taxRate: 0.19 },
];

await oracle(process.argv[2], async ({ load, readSources }) => {
    const { computeTotals } = await load('src/totals.js');
    const { formatInvoice, formatQuote } = await load('src/documents.js');
    const { grandTotal } = await load('src/summary.js');

    for (const { lines, taxRate } of cases) {
        const expected = golden(lines, taxRate);
        assert.deepEqual(computeTotals(lines, taxRate), expected, `computeTotals ${JSON.stringify(lines)}`);
        assert.equal(
            formatInvoice({ number: 'N', taxRate, lines }),
            `INVOICE N\nSubtotal: ${expected.subtotal.toFixed(2)}\nTax: ${expected.tax.toFixed(2)}\nTotal: ${expected.total.toFixed(2)}`,
        );
        assert.equal(
            formatQuote({ number: 'N', validUntil: 'D', taxRate, lines }),
            `QUOTE N (valid until D)\nSubtotal: ${expected.subtotal.toFixed(2)}\nTax: ${expected.tax.toFixed(2)}\nTotal: ${expected.total.toFixed(2)}`,
        );
    }
    const orders = cases.map(({ lines, taxRate }) => ({ lines, taxRate }));
    let sum = 0;
    for (const { lines, taxRate } of cases) {
        sum += golden(lines, taxRate).total;
    }
    assert.equal(grandTotal(orders), Math.round(sum * 100) / 100);
    assert.equal(grandTotal([]), 0);

    // The duplicate is gone: the line-total loop and the tax rounding live only in totals.js.
    for (const { name, text } of readSources('src')) {
        if (name === 'totals.js') {
            continue;
        }
        assert.ok(!/\.qty\s*\*/.test(text), `${name} still computes line totals itself`);
        assert.ok(!/\*\s*\w+\.taxRate\s*\*/.test(text), `${name} still computes tax itself`);
    }
    const totals = readSources('src').find(source => source.name === 'totals.js');
    assert.equal((totals.text.match(/\.qty\s*\*/g) ?? []).length, 1, 'a single line-total computation');
});
