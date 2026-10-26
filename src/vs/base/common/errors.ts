/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/errors.ts
// Deviation: the default handler doesn't rethrow as upstream does but logs to
// console.error: the vendored diff's `assertFn` fires on edge-case inputs, and
// crashing the TUI over that is out of proportion.

/**
 * Error indicating a bug in the code — only catch it to recover gracefully.
 */
export class BugIndicatingError extends Error {
    public constructor(message?: string) {
        // `||`, not `??`: an empty message also gets the default text, as upstream.
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        super(message || "An unexpected bug occurred.");
        Object.setPrototypeOf(this, BugIndicatingError.prototype);
    }
}

let unexpectedErrorHandler: (e: unknown) => void = (e) => {
    console.error(e);
};

export function setUnexpectedErrorHandler(handler: (e: unknown) => void): void {
    unexpectedErrorHandler = handler;
}

export function onUnexpectedError(e: unknown): void {
    unexpectedErrorHandler(e);
}

/**
 * A write to a closed pipe (the reader of our stdout/stderr is gone): there is nowhere left to report it.
 */
export function isSigPipeError(e: unknown): e is Error {
    if (e === null || typeof e !== "object") {
        return false;
    }

    const cast = e as Record<string, string | undefined>;
    return cast.code === "EPIPE" && cast.syscall?.toUpperCase() === "WRITE";
}
