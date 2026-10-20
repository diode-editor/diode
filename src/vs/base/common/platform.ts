/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/platform.ts
// Узкое извлечение — см. шапку src/vs/base/common/arrays.ts. Полный upstream —
// определение ОС/локали на верхнем уровне модуля, которое нам запрещено
// (V8-снапшот, AGENTS.md «Верхний уровень модулей»).

import { onUnexpectedError } from "./errors.ts";

/**
 * Макрозадача «как можно скорее», но после ввода-вывода. Upstream в браузере —
 * `postMessage` (обходит клэмп `setTimeout` в 4 мс), в Node — `setTimeout(cb)`,
 * то есть минимум 1 мс простоя на каждый вызов.
 *
 * ОСОЗНАННОЕ ОТКЛОНЕНИЕ: у нас `setImmediate` — Node-аналог браузерной ветки
 * эталона. Фоновая токенизация работает кусками по ~1 мс и уступает между ними
 * через `setTimeout0`; с `setTimeout` половина времени уходила бы на простой
 * (200k строк — вдвое дольше), а `setImmediate` пропускает вперёд фазу poll,
 * так что нажатия клавиш между кусками обрабатываются так же.
 */
export function setTimeout0(callback: () => void): void {
    setImmediate(() => {
        // В браузере эталона исключение макрозадачи только логируется
        // (window.onerror), в Node — роняет процесс. Сбой фоновой работы
        // (кусок токенизации) не должен ронять редактор — как в эталоне.
        try {
            callback();
        } catch (e) {
            onUnexpectedError(e);
        }
    });
}
