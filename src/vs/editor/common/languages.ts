/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/editor/common/languages.ts
// Узкое извлечение: из ~2.5k строк upstream — только контракт токенизатора
// под перенесённую токенизацию.

import type { LanguageId } from "./encodedTokenAttributes.ts";
import type { IState } from "./languages/iState.ts";
import type { ContiguousMultilineTokens } from "./tokens/contiguousMultilineTokens.ts";

export type { IState };

export class Token {
    public readonly offset: number;
    public readonly type: string;
    public readonly language: string;

    public constructor(offset: number, type: string, language: string) {
        this.offset = offset;
        this.type = type;
        this.language = language;
    }

    public toString(): string {
        return "(" + String(this.offset) + ", " + this.type + ")";
    }
}

export class TokenizationResult {
    public readonly tokens: Token[];
    public readonly endState: IState;

    public constructor(tokens: Token[], endState: IState) {
        this.tokens = tokens;
        this.endState = endState;
    }
}

/** Наш vscode-textmate шрифтов не отдаёт: массив всегда пуст, держим ради формы upstream-конструктора. */
export interface IFontToken {
    readonly startIndex: number;
    readonly endIndex: number;
    readonly fontFamily: string | null;
    readonly fontSizeMultiplier: number | null;
    readonly lineHeightMultiplier: number | null;
}

export class EncodedTokenizationResult {
    /**
     * The tokens in binary format. Each token occupies two array indices. For token i:
     *  - at offset 2*i => startIndex
     *  - at offset 2*i + 1 => metadata
     */
    public readonly tokens: Uint32Array;
    public readonly fontInfo: IFontToken[];
    public readonly endState: IState;

    public constructor(tokens: Uint32Array, fontInfo: IFontToken[], endState: IState) {
        this.tokens = tokens;
        this.fontInfo = fontInfo;
        this.endState = endState;
    }
}

/** Без upstream `tokenize` и `createBackgroundTokenizer`: нужен только бинарный путь. */
export interface ITokenizationSupport {
    getInitialState(): IState;
    tokenizeEncoded(line: string, hasEOL: boolean, state: IState): EncodedTokenizationResult;
}

/** Встроенные языки грамматик не различаем: кодек токен-стора отдаёт 0. */
export interface ILanguageIdCodec {
    encodeLanguageId(languageId: string): LanguageId;
    decodeLanguageId(languageId: LanguageId): string;
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
