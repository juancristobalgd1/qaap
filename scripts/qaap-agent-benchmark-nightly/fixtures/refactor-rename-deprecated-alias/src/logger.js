let sink = line => process.stdout.write(`${line}\n`);

/** Replace the output sink (used by tests). */
export function setSink(fn) {
    sink = fn;
}

/** Write one log line `[LEVEL] message` to the sink and return it. */
export function logMsg(level, msg) {
    const line = `[${level.toUpperCase()}] ${msg}`;
    sink(line);
    return line;
}
