export function showNotification(root, message) {
    const element = root.querySelector('[data-notification]');
    element.textContent = String(message ?? '');
}
