import assert from 'node:assert/strict';
import test from 'node:test';
import { formatInvoice, formatQuote } from '../src/documents.js';
import { grandTotal } from '../src/summary.js';

const lines = [{ qty: 2, unitPrice: 9.99 }, { qty: 1, unitPrice: 5 }];

test('invoice', () => {
    assert.equal(
        formatInvoice({ number: 'INV-1', taxRate: 0.1, lines }),
        'INVOICE INV-1\nSubtotal: 24.98\nTax: 2.50\nTotal: 27.48',
    );
});

test('quote', () => {
    assert.equal(
        formatQuote({ number: 'Q-7', validUntil: '2025-01-31', taxRate: 0.2, lines }),
        'QUOTE Q-7 (valid until 2025-01-31)\nSubtotal: 24.98\nTax: 5.00\nTotal: 29.98',
    );
});

test('grand total', () => {
    assert.equal(grandTotal([{ taxRate: 0.1, lines }, { taxRate: 0, lines: [{ qty: 1, unitPrice: 1 }] }]), 28.48);
});
