/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/editor/common/model/mirrorTextModel.ts
// Узкое извлечение под перенесённый model/textModelTokens.ts (см. шапку
// src/vs/base/common/arrays.ts): только форма правки, которую принимает
// `acceptChanges`. Адаптер зовёт `acceptChange` напрямую, так что значений
// этого типа у нас никто не строит.

import type { IRange } from "../core/range.ts";

export interface IModelContentChange {
    /** The range that got replaced. */
    readonly range: IRange;
    /** The new text for the range. */
    readonly text: string;
}
