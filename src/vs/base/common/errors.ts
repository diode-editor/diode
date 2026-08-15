/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/errors.ts
// Узкое извлечение — см. шапку src/vs/base/common/arrays.ts.
//
// ОСОЗНАННОЕ ОТКЛОНЕНИЕ ОТ UPSTREAM: дефолтный обработчик здесь только пишет в
// console.error, тогда как upstream перебрасывает ошибку асинхронно через
// setTimeout — то есть роняет процесс. Нам это не подходит: `assertFn` в
// перенесённом алгоритме диффа срабатывает на пограничных входах, и падение
// всего TUI из-за неидеального выравнивания ханков — несоразмерная реакция.
// Тесты, которым нужно строгое поведение upstream, ставят свой обработчик
// через setUnexpectedErrorHandler (так делает и фикстурный корпус upstream).

/**
 * Error indicating a bug in the code — only catch it to recover gracefully.
 */
export class BugIndicatingError extends Error {
    public constructor(message?: string) {
        // Именно `||`, а не `??`: пустое сообщение должно давать текст по
        // умолчанию, как в upstream. Замена на `??` изменила бы поведение.
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        super(message || "An unexpected bug occurred.");
        Object.setPrototypeOf(this, BugIndicatingError.prototype);
    }
}

let unexpectedErrorHandler: (e: unknown) => void = (e) => {
    console.error(e);
};

/** Ставит обработчик непредвиденных ошибок. Возвращать прежний — не требуется никому из потребителей. */
export function setUnexpectedErrorHandler(handler: (e: unknown) => void): void {
    unexpectedErrorHandler = handler;
}

export function onUnexpectedError(e: unknown): void {
    unexpectedErrorHandler(e);
}
