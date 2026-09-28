/**
 * Человекочитаемое описание причины unhandled rejection — для последней
 * страховки процесса (`process.on("unhandledRejection")` в главном процессе и в
 * extension host'е).
 *
 * `String(err)` на Error даёт только «Error: message» — по такой строке не найти
 * ни виноватое расширение, ни строку кода. Стек называет и то, и другое;
 * у не-Error причин (строка, объект) стека нет — их печатаем как есть.
 */
export function describeRejection(reason: unknown): string {
    if (reason instanceof Error) return reason.stack ?? `${reason.name}: ${reason.message}`;
    return String(reason);
}
