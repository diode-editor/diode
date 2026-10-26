/**
 * The stack, not `String(err)`: only it points to the culprit extension and line. Never throws: it runs
 * inside the process's last-resort handlers, where a throw exits the process (#861).
 */
export function describeRejection(reason: unknown): string {
    try {
        if (reason instanceof Error) return reason.stack ?? `${reason.name}: ${reason.message}`;
        return String(reason);
    } catch {
        // A null-prototype object, a throwing `stack` getter or `toString`.
        return `${Object.prototype.toString.call(reason)} (could not be described)`;
    }
}
