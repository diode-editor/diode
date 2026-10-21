/** Стек, а не `String(err)`: только по нему находятся виноватое расширение и строка. */
export function describeRejection(reason: unknown): string {
    if (reason instanceof Error) return reason.stack ?? `${reason.name}: ${reason.message}`;
    return String(reason);
}
