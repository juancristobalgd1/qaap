import { log } from './logger.js';

export function runJob(name, fn) {
    log('debug', `job ${name} started`);
    try {
        const result = fn();
        log('debug', `job ${name} finished`);
        return result;
    } catch (error) {
        log('error', `job ${name} failed: ${error.message}`);
        throw error;
    }
}
