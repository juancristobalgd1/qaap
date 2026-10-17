/**
 * Call `fn` whichever style it uses: callback-last (Node style) or promise-returning.
 */
export function call(fn, ...args) {
    return new Promise((resolve, reject) => {
        const result = fn(...args, (error, value) => (error ? reject(error) : resolve(value)));
        if (result && typeof result.then === 'function') {
            result.then(resolve, reject);
        }
    });
}
