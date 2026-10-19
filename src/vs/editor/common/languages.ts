/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/editor/common/languages.ts
// Узкое извлечение под перенесённый model/textModelTokens.ts (см. шапку
// src/vs/base/common/arrays.ts). Upstream — ~2.5k строк провайдеров языковых
// фич; здесь только контракт токенизатора, который видит перенесённый код.
//
// ШОВ B1/B2 (docs/TODO/VscodeModel.md): в upstream `tokenizeEncoded` отдаёт
// бинарные токены (`Uint32Array`, метаданные с colorId), у нас токены — стеки
// скоупов (`ILineTokens`). Перенесённый алгоритм их не читает — только
// передаёт из токенизатора в builder, — поэтому формат подменяется здесь, а
// адаптер (`tokens/documentTokenStore.ts`) оборачивает наш `ITokenizationSupport`.
// Переход на бинарные токены (B2) заменит этот шим upstream-типами.

import type { ILineTokens } from "./languages/iLineTokens.ts";
import type { IState } from "./languages/iState.ts";
import type { ContiguousMultilineTokens } from "./tokens/contiguousMultilineTokens.ts";

export type { IState };

/** Результат токенизации строки; `tokens` — наш формат, см. шапку файла. */
export interface EncodedTokenizationResult {
    readonly tokens: ILineTokens;
    readonly endState: IState;
}

export interface ITokenizationSupport {
    getInitialState(): IState;
    tokenizeEncoded(line: string, hasEOL: boolean, state: IState): EncodedTokenizationResult;
}

/** Числовой id языка для бинарных метаданных; у наших токенов не используется. */
export interface ILanguageIdCodec {
    encodeLanguageId(languageId: string): number;
}

export interface IBackgroundTokenizer {
    dispose(): void;
    /**
     * Instructs the background tokenizer to set the tokens for the given range again.
     *
     * This might be necessary if the renderer overwrote those tokens with heuristically computed ones for some viewport,
     * when the change does not even propagate to that viewport.
     */
    requestTokens(startLineNumber: number, endLineNumberExclusive: number): void;
}

export interface IBackgroundTokenizationStore {
    setTokens(tokens: ContiguousMultilineTokens[]): void;
    /**
     * Should be called to indicate that the background tokenization has finished for now.
     */
    backgroundTokenizationFinished(): void;
}
