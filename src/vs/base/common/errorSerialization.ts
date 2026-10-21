/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Extracted from upstream `src/vs/base/common/errors.ts` (microsoft/vscode@1.127.0):
// logic and names verbatim, without `noTelemetry`/`ErrorNoTelemetry`: there is no telemetry.
type ErrorWithCode = Error & {
    code: string | undefined;
};

export interface SerializedError {
    readonly $isError: true;
    readonly name: string;
    readonly message: string;
    readonly stack: string;
    readonly code?: string;
    readonly cause?: SerializedError;
}

export function transformErrorForSerialization(error: Error): SerializedError;
export function transformErrorForSerialization(error: unknown): unknown;
export function transformErrorForSerialization(error: unknown): unknown {
    if (error instanceof Error) {
        const { name, message, cause } = error;
        // `||` on purpose, as upstream: an empty `stacktrace` yields to `stack`.
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        const stack = (error as { stacktrace?: string }).stacktrace || error.stack;
        return {
            $isError: true,
            name,
            message,
            stack,
            cause: cause ? transformErrorForSerialization(cause) : undefined,
            code: (error as ErrorWithCode).code,
        };
    }

    // return as is
    return error;
}

export function transformErrorFromSerialization(data: SerializedError): Error {
    const error = new Error();
    error.name = data.name;
    error.message = data.message;
    error.stack = data.stack;
    if (data.code) {
        (error as ErrorWithCode).code = data.code;
    }
    if (data.cause) {
        error.cause = transformErrorFromSerialization(data.cause);
    }
    return error;
}

export const canceledName = "Canceled";

/**
 * Checks if the given error is a promise in canceled state
 */
export function isCancellationError(error: unknown): boolean {
    // Stryker disable next-line ConditionalExpression,BlockStatement: equivalent, an instance always also has the shape the check below recognizes
    if (error instanceof CancellationError) {
        return true;
    }
    return error instanceof Error && error.name === canceledName && error.message === canceledName;
}

// !!!IMPORTANT!!!
// Do NOT change this class because it is also used as an API-type.
export class CancellationError extends Error {
    public constructor() {
        super(canceledName);
        this.name = this.message;
    }
}
