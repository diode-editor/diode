/**
 * Запросы хоста к субпроцессу и перевод их ответов в форму ядра. Только
 * хостовая сторона провода: субпроцесс эти функции не зовёт, а значения
 * `services/*` (здесь — save-участники `services/textfile`) в общий слой
 * `api/common` не тянутся.
 */

import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { IHostToSubprocess } from "../../../api/common/extHostProtocol.ts";
import type { IRequestOptions, RequestMethod, RequestParams, RequestResult } from "../../../api/common/rpcEndpoint.ts";
import type { IWireWillSaveParams, WireTextEdit } from "../../../api/common/wireTypes.ts";
import type { ISaveEdit } from "../../textfile/common/iSaveParticipant.ts";

/** Переводит wire-правки в core-правки ({@link ISaveEdit}). */
export function wireToSaveEdits(wire: readonly WireTextEdit[]): ISaveEdit[] {
    return wire.map((edit) =>
        "setEndOfLine" in edit
            ? { kind: "eol", eol: edit.setEndOfLine === 2 ? EndOfLine.CRLF : EndOfLine.LF }
            : { kind: "text", range: edit.range, text: edit.text },
    );
}

/** Запросы хоста к субпроцессу (см. `extHostProtocol.ts`). */
type HostToSubprocess = IHostToSubprocess;

/**
 * Отправка запроса субпроцессу (обычно `rpc.request`): срок ответа и отмену
 * несёт транспорт — истёкший срок отменяет запрос на второй стороне и
 * отклоняет промис `TimeoutError`. Ответ типизирован картой протокола: его
 * форму гарантирует сериализатор субпроцесса, хост её не перепроверяет.
 * Голая функция — чтобы логику запросов можно было юнит-тестировать через
 * {@link InProcessChannelPair} без форка.
 */
export type RequestFn = <K extends RequestMethod<HostToSubprocess>>(
    method: K,
    params: RequestParams<HostToSubprocess, K>,
    options: IRequestOptions,
) => Promise<RequestResult<HostToSubprocess, K>>;

/**
 * Запрашивает у subprocess'а правки will-save с таймаутом. Возвращает пустой
 * массив на таймаут или ошибку RPC — сохранение никогда не
 * блокируется навсегда и не портит данные. `request` — голая функция (обычно
 * `rpc.request`), чтобы логику можно было юнит-тестировать через
 * {@link InProcessChannelPair} без форка subprocess'а.
 */
export async function requestWillSaveEdits(
    request: RequestFn,
    params: IWireWillSaveParams,
    timeoutMs: number,
): Promise<ISaveEdit[]> {
    // Сбой запроса (истёк срок, отказ RPC) — «правок нет»; в лог его пишет тот, кто дал `request`.
    const edits = await request("workspace.willSaveTextDocument", params, { timeoutMs }).catch(() => []);
    return wireToSaveEdits(edits);
}
