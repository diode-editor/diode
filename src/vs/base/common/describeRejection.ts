/** The stack, not `String(err)`: only it points to the culprit extension and line. */
export function describeRejection(reason: unknown): string {
    if (reason instanceof Error) return reason.stack ?? `${reason.name}: ${reason.message}`;
    return String(reason);
}
