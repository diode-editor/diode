/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/date.ts
// Узкое извлечение — см. шапку src/vs/base/common/arrays.ts. Перенесённому
// core/wordCharacterClassifier.ts нужен только `safeIntl.Segmenter`. `Intl.*`
// создаётся лениво, при первом чтении `.value`, — верхнему уровню модуля это
// не нужно (V8-снапшот, docs/arch/Common.md).

import { Lazy } from "./lazy.ts";

export const safeIntl = {
    Segmenter(locales?: Intl.LocalesArgument, options?: Intl.SegmenterOptions): Lazy<Intl.Segmenter> {
        return new Lazy(() => {
            try {
                return new Intl.Segmenter(locales, options);
            } catch {
                return new Intl.Segmenter(undefined, options);
            }
        });
    },
};
