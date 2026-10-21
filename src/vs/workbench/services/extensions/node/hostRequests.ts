import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { IHostToSubprocess } from "../../../api/common/extHostProtocol.ts";
import type { IRequestOptions, RequestMethod, RequestParams, RequestResult } from "../../../api/common/rpcEndpoint.ts";
import type { IWireWillSaveParams, WireTextEdit } from "../../../api/common/wireTypes.ts";
import type { ISaveEdit } from "../../textfile/common/iSaveParticipant.ts";

export function wireToSaveEdits(wire: readonly WireTextEdit[]): ISaveEdit[] {
    return wire.map((edit) =>
        "setEndOfLine" in edit
            ? { kind: "eol", eol: edit.setEndOfLine === 2 ? EndOfLine.CRLF : EndOfLine.LF }
            : { kind: "text", range: edit.range, text: edit.text },
    );
}

type HostToSubprocess = IHostToSubprocess;

/** Срок и отмену несёт транспорт; форму ответа гарантирует сериализатор субпроцесса, хост её не перепроверяет. */
export type RequestFn = <K extends RequestMethod<HostToSubprocess>>(
    method: K,
    params: RequestParams<HostToSubprocess, K>,
    options: IRequestOptions,
) => Promise<RequestResult<HostToSubprocess, K>>;

/** Таймаут или ошибка RPC — пустой массив: сохранение не блокируется навсегда. */
export async function requestWillSaveEdits(
    request: RequestFn,
    params: IWireWillSaveParams,
    timeoutMs: number,
): Promise<ISaveEdit[]> {
    // Сбой запроса (истёк срок, отказ RPC) — «правок нет»; в лог его пишет тот, кто дал `request`.
    const edits = await request("workspace.willSaveTextDocument", params, { timeoutMs }).catch(() => []);
    return wireToSaveEdits(edits);
}
