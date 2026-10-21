/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/editor/common/model/mirrorTextModel.ts
// Узкое извлечение: только форма правки для перенесённых textModelTokens и PieceTree.

import type { IRange } from "../core/range.ts";

export interface IModelContentChange {
    /**
     * The old range that got replaced.
     */
    readonly range: IRange;
    /**
     * The offset of the range that got replaced.
     */
    readonly rangeOffset: number;
    /**
     * The length of the range that got replaced.
     */
    readonly rangeLength: number;
    /**
     * The new text for the range.
     */
    readonly text: string;
}
