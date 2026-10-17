import { log } from './logger.js';

export function startApp(name) {
    log('info', `starting ${name}`);
    return { name, running: true };
}

export function stopApp(app, reason) {
    if (reason) {
        log('warn', `stopping ${app.name}: ${reason}`);
    } else {
        log('info', `stopping ${app.name}`);
    }
    return { ...app, running: false };
}
