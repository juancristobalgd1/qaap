import { logMsg } from './logger.js';

export function startApp(name) {
    logMsg('info', `starting ${name}`);
    return { name, running: true };
}

export function stopApp(app, reason) {
    if (reason) {
        logMsg('warn', `stopping ${app.name}: ${reason}`);
    } else {
        logMsg('info', `stopping ${app.name}`);
    }
    return { ...app, running: false };
}
