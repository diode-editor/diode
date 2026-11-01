import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { HostRpc } from "../../../api/common/extHostProtocol.ts";
import { TimeoutError } from "../../../api/common/rpcEndpoint.ts";

import type { RequestFn } from "./hostRequests.ts";

/**
 * Ms. An expired deadline cancels the request with an empty result; inline completions take the deadline
 * from the request. `provideCompletionItems` is intentionally absent, as upstream: on an empty response
 * the core opens the popup with buffer words, and a slow language server would be left without its items.
 */
export const DEFAULT_REQUEST_TIMEOUTS = {
    "workspace.willSaveTextDocument": 1500,
    "languages.resolveCompletionItem": 1500,
    "languages.provideInlineCompletions": 5000,
    "languages.provideFoldingRanges": 1500,
    "languages.provideDefinition": 5000,
    "languages.provideImplementation": 5000,
    "languages.provideTypeDefinition": 5000,
    "languages.provideDeclaration": 5000,
    "languages.provideHover": 5000,
    "languages.provideReferences": 5000,
    "languages.provideSignatureHelp": 5000,
    "languages.provideFormattingEdits": 5000,
    "languages.provideCodeActions": 5000,
    "languages.applyCodeAction": 10000,
    "languages.prepareRename": 5000,
    "languages.provideRenameEdits": 10000,
    "languages.provideSelectionRanges": 5000,
    "languages.provideDocumentColors": 5000,
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
