/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/editor/common/languages/nullTokenize.ts
// Узкое извлечение под перенесённый model/textModelTokens.ts (см. шапку
// src/vs/base/common/arrays.ts и шов формата в ../languages.ts): результат
// «токенизатор упал» — один токен без скоупов на всю строку, состояние то же.

import type { EncodedTokenizationResult, IState } from "../languages.ts";

import { createLineTokens, createToken } from "./iLineTokens.ts";

export function nullTokenizeEncoded(_languageId: number, state: IState): EncodedTokenizationResult {
    return { tokens: createLineTokens([createToken(0, [])]), endState: state };
}
