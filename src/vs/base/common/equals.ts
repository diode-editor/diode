/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/equals.ts
// Узкое извлечение — см. шапку src/vs/base/common/arrays.ts.

export interface IEquatable<T> {
    equals(other: T): boolean;
}
