/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Сериализация ошибок через границу процесса (RPC extension host'а) и ошибка
// отмены — извлечение из upstream `src/vs/base/common/errors.ts`
// (microsoft/vscode@1.127.0): логика и имена дословно, форматирование наше.
// Одно отличие: без `noTelemetry`/`ErrorNoTelemetry` — телеметрии у нас нет, а
// класс потянул бы за собой свою иерархию. Отдельным модулем, а не в шиме
// `errors.ts`: тот — узкое извлечение под перенесённый дифф.
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
        // Именно `||`, как в upstream: пустой `stacktrace` уступает `stack`.
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
    // Stryker disable next-line ConditionalExpression,BlockStatement: эквивалентны — экземпляр всегда имеет и форму, которую узнаёт проверка ниже
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
