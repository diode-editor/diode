/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/editor/common/languages.ts
// Narrow extraction: of upstream's ~2.5k lines, only the tokenizer contract
// needed by the ported tokenization.

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

/** Our vscode-textmate returns no fonts: the array is always empty, kept for the upstream constructor shape. */
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

/** Without upstream `tokenize` and `createBackgroundTokenizer`: only the binary path is needed. */
export interface ITokenizationSupport {
    getInitialState(): IState;
    tokenizeEncoded(line: string, hasEOL: boolean, state: IState): EncodedTokenizationResult;
}

/** Embedded grammar languages are not distinguished: the token store codec returns 0. */
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
