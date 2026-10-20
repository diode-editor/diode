/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/test/common/utils.ts
// Путь upstream — для дословно перенесённых upstream-тестов
// (`scripts/import-vscode-editor.mjs`): их относительный импорт смотрит сюда.
// Сам учёт утечек — наш аналог хелпера эталона на vitest.

export { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../TestUtils/disposableLeaks.ts";
