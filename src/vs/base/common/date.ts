/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/date.ts
// `Intl.*` создаётся лениво: на верхнем уровне модуля его не пускает V8-снапшот.

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
