import { logMsg } from './logger.js';

export function runJob(name, fn) {
    logMsg('debug', `job ${name} started`);
    try {
        const result = fn();
        logMsg('debug', `job ${name} finished`);
        return result;
    } catch (error) {
        logMsg('error', `job ${name} failed: ${error.message}`);
        throw error;
    }
}
