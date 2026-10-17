/** Grand total (tax included) of a list of orders, rounded to cents. */
export function grandTotal(orders) {
    let sum = 0;
    for (const order of orders) {
        let subtotal = 0;
        for (const line of order.lines) {
            subtotal += line.qty * line.unitPrice;
        }
        const tax = Math.round(subtotal * order.taxRate * 100) / 100;
        sum += Math.round((subtotal + tax) * 100) / 100;
    }
    return Math.round(sum * 100) / 100;
}
