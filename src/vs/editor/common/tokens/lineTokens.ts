/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/editor/common/tokens/lineTokens.ts
// Узкое извлечение под перенесённый model/textModelTokens.ts (см. шапку
// src/vs/base/common/arrays.ts и шов формата в ../languages.ts).

import type { ILineTokens } from "../languages/iLineTokens.ts";

// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- форма upstream: перенесённый код зовёт статический метод класса
export class LineTokens {
    /**
     * Upstream переводит бинарные токены из «смещение начала» в «смещение конца».
     * Наши токены (`ILineTokens`) хранят начало и конец не хранят вовсе —
     * переводить нечего.
     */
    public static convertToEndOffset(_tokens: ILineTokens, _lineTextLength: number): void {
        // no-op: см. выше
    }
}
