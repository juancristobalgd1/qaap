import { computeTotals } from './totals.js';

export function grandTotal(orders) {
    let sum = 0;
    for (const order of orders) {
        sum += computeTotals(order.lines, order.taxRate).total;
    }
    return Math.round(sum * 100) / 100;
}
