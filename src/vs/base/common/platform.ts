/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/platform.ts
// Узкое извлечение: полный upstream определяет ОС на верхнем уровне модуля, а это ломает V8-снапшот.

import { onUnexpectedError } from "./errors.ts";

/**
 * `setImmediate`, а не `setTimeout` Node-ветки эталона: токенизация уступает
 * кусками по ~1 мс, и минимальная 1 мс простоя `setTimeout` удвоила бы время;
 * ввод между кусками при этом обрабатывается так же — фаза poll идёт раньше.
 */
export function setTimeout0(callback: () => void): void {
    setImmediate(() => {
        // В Node исключение макрозадачи роняет процесс, а в браузере эталона только логируется.
        try {
            callback();
        } catch (e) {
            onUnexpectedError(e);
        }
    });
}
