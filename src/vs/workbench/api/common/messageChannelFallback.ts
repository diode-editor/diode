/**
 * What the JSON transport put on the wire: functions, symbols and `undefined` fields dropped, `toJSON()`
 * honored, `Date` as a string. Throws like `JSON.stringify` (a cycle, a `BigInt`) — and on a bare function,
 * whose image is no JSON at all.
 */
export function jsonImage(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value));
}

/**
 * The envelope of an RPC message for a log line (`req#7 commands.executeCommand`, `notif window.statusBarItem.update`);
 * the payload itself may be huge or un-loggable. A string: the subprocess's stderr logger prints objects as `[object Object]`.
 */
export function summarizeMessage(message: unknown): string {
    if (typeof message !== "object" || message === null) return "message";
    const { kind, method, id } = message as { kind?: unknown; method?: unknown; id?: unknown };
    const head = typeof kind === "string" ? kind : "message";
    const idPart = typeof id === "number" ? `#${String(id)}` : "";
    const methodPart = typeof method === "string" ? ` ${method}` : "";
    return `${head}${idPart}${methodPart}`;
}
