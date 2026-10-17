let sink = line => process.stdout.write(`${line}\n`);
let warned = false;

export function setSink(fn) {
    sink = fn;
}

export function log(level, message) {
    const line = `[${level.toUpperCase()}] ${message}`;
    sink(line);
    return line;
}

/** @deprecated Use {@link log}. */
export function logMsg(level, msg) {
    if (!warned) {
        warned = true;
        process.emitWarning('logMsg() is deprecated, use log()', 'DeprecationWarning', 'QAAP_LOGMSG');
    }
    return log(level, msg);
}
