import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { HostRpc } from "../../../api/common/extHostProtocol.ts";
import { TimeoutError } from "../../../api/common/rpcEndpoint.ts";

import type { RequestFn } from "./hostRequests.ts";

/**
 * Ms. An expired deadline cancels the request with an empty result; inline completions take the deadline
 * from the request. `provideCompletionItems` is intentionally absent, as upstream: on an empty response
 * the core opens the popup with buffer words, and a slow language server would be left without its items.
 * Inlay hints and code lens are absent too, as upstream: nothing asks again after an empty answer, so a server busy
 * with its import (jdt.ls) would leave "no commands" on the frame for good; an edit cancels them through the token.
 * Document colors and links are absent for the same reason: Tailwind's server answers the first request only once its
 * project is built, and a cancelled one left the file without squares and links until an edit.
 * Formatting is absent as upstream too: a large file takes a formatter longer than any deadline here, an edit cancels
 * the request, and format on save cancels it at the save participant's deadline.
 * Navigation the user asked for (definition and its kin, references, both hierarchies) is absent as upstream: on a big
 * project tsserver searches longer than any deadline here, jdt.ls takes longer than 5 s while it is busy, and an expired
 * one read as "nothing found". Only the caller cancels: go-to on a cursor move, an edit or a new request, references and
 * the hierarchies on a new request or a clear. On type formatting too: a key is pressed once, nothing asks again, and
 * the next edit cancels the request.
 */
export const DEFAULT_REQUEST_TIMEOUTS = {
    "workspace.willSaveTextDocument": 1500,
    "languages.resolveCompletionItem": 1500,
    "languages.provideInlineCompletions": 5000,
    "languages.provideFoldingRanges": 1500,
    "languages.provideDocumentSymbols": 5000,
    // Deliberately above the positional 5000: a project-wide search on JDT or gopls takes longer.
    "languages.provideWorkspaceSymbols": 10000,
    "languages.resolveWorkspaceSymbol": 10000,
    "languages.provideHover": 5000,
    "languages.provideSignatureHelp": 5000,
    "languages.provideCodeActions": 5000,
    "languages.applyCodeAction": 10000,
    "languages.prepareRename": 5000,
    "languages.provideRenameEdits": 10000,
    "languages.provideSelectionRanges": 5000,
    "languages.provideDocumentHighlights": 5000,
    "languages.provideLinkedEditingRanges": 5000,
    "languages.resolveDocumentLink": 5000,
} as const satisfies Readonly<Record<string, number>>;

export type TimedRequestMethod = keyof typeof DEFAULT_REQUEST_TIMEOUTS;

export type RequestTimeouts = Readonly<Record<TimedRequestMethod, number>>;

/** An expired deadline logs debug (normal for a slow provider), a failure logs warn. */
export function loggingRequest(rpc: HostRpc, logger: ILogger | undefined): RequestFn {
    return (method, params, options) =>
        rpc.request(method, params, options).catch((error: unknown) => {
            if (error instanceof TimeoutError) {
                logger?.debug(error.message);
            } else {
                logger?.warn(`request "${method}" failed`, error);
            }
            throw error;
        });
}
