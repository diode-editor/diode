/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/editor/common/model.ts
// Узкое извлечение под перенесённый model/textModelTokens.ts (см. шапку
// src/vs/base/common/arrays.ts): из ~1.6k строк `ITextModel` перенесённому
// коду нужны шесть методов. Координаты upstream — строки и колонки с 1;
// реализация над нашим 0-based документом — адаптер в
// `tokens/documentTokenStore.ts` (±1 живёт только там, docs/arch/Editor.md).

export interface ITextModel {
    getLanguageId(): string;
    getLineCount(): number;
    getLineContent(lineNumber: number): string;
    getLineLength(lineNumber: number): number;
    /** Колонка (с 1) первого непробельного символа; 0 — строка пуста или из одних пробелов. */
    getLineFirstNonWhitespaceColumn(lineNumber: number): number;
    isAttachedToEditor(): boolean;
}
