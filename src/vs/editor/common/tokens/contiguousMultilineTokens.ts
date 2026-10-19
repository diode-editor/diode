/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/editor/common/tokens/contiguousMultilineTokens.ts
// Узкое извлечение (см. шапку src/vs/base/common/arrays.ts и шов формата в
// ../languages.ts): токены подряд идущих строк, строки — с 1, как в upstream.

import type { ILineTokens } from "../languages/iLineTokens.ts";

export class ContiguousMultilineTokens {
    /** The start line number for this block of tokens. */
    public readonly startLineNumber: number;
    private readonly tokens: ILineTokens[];

    public constructor(startLineNumber: number, tokens: ILineTokens[]) {
        this.startLineNumber = startLineNumber;
        this.tokens = tokens;
    }

    /** The end line number for this block of tokens (inclusive). */
    public get endLineNumber(): number {
        return this.startLineNumber + this.tokens.length - 1;
    }

    public getLineTokens(lineNumber: number): ILineTokens | undefined {
        return this.tokens[lineNumber - this.startLineNumber];
    }

    public appendLineTokens(lineTokens: ILineTokens): void {
        this.tokens.push(lineTokens);
    }
}
