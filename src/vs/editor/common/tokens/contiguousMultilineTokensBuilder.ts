/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/editor/common/tokens/contiguousMultilineTokensBuilder.ts
// Узкое извлечение (см. шапку src/vs/base/common/arrays.ts и шов формата в
// ../languages.ts): без (де)сериализации — она нужна только воркеру (B3).

import type { ILineTokens } from "../languages/iLineTokens.ts";

import { ContiguousMultilineTokens } from "./contiguousMultilineTokens.ts";

export class ContiguousMultilineTokensBuilder {
    private readonly tokens: ContiguousMultilineTokens[] = [];

    public add(lineNumber: number, lineTokens: ILineTokens): void {
        const last = this.tokens.at(-1);
        if (last?.endLineNumber === lineNumber - 1) {
            // append
            last.appendLineTokens(lineTokens);
            return;
        }
        this.tokens.push(new ContiguousMultilineTokens(lineNumber, [lineTokens]));
    }

    public finalize(): ContiguousMultilineTokens[] {
        return this.tokens;
    }
}
