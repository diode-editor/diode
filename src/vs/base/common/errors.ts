/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/errors.ts
// Отклонение: дефолтный обработчик не перебрасывает ошибку, как upstream, а
// пишет в console.error — `assertFn` перенесённого диффа срабатывает на
// пограничных входах, и ронять из-за этого TUI несоразмерно.

/**
 * Error indicating a bug in the code — only catch it to recover gracefully.
 */
export class BugIndicatingError extends Error {
    public constructor(message?: string) {
        // `||`, а не `??`: пустое сообщение тоже даёт текст по умолчанию, как в upstream.
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
