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

/**
 * The transport carries deadline and cancellation; the subprocess serializer guarantees the response shape, the
 * host doesn't recheck it.
 */
export type RequestFn = <K extends RequestMethod<HostToSubprocess>>(
    method: K,
    params: RequestParams<HostToSubprocess, K>,
    options: IRequestOptions,
) => Promise<RequestResult<HostToSubprocess, K>>;

/** A timeout or RPC error yields an empty array, so saving never blocks forever. */
export async function requestWillSaveEdits(
    request: RequestFn,
    params: IWireWillSaveParams,
    timeoutMs: number,
): Promise<ISaveEdit[]> {
    // A failed request (deadline expired, RPC failure) means "no edits"; whoever supplied `request` logs it.
    const edits = await request("workspace.willSaveTextDocument", params, { timeoutMs }).catch(() => []);
    return wireToSaveEdits(edits);
}
