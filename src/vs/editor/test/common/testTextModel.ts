/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/editor/test/common/testTextModel.ts
// Путь upstream — для дословно перенесённых upstream-тестов PieceTree
// (`model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts`, сьют `snapshot`).
// Upstream `createTextModel` поднимает весь `TextModel` с DI-сервисами; его мы
// не переносим (docs/TODO/VscodeModel.md, ветка C). Здесь — ровно путь, которым
// TextModel эталона ведёт эти кейсы к буферу: фабрика из
// `PieceTreeTextBufferBuilder` (нормализация EOL, LF по умолчанию — как
// `TextModel.DEFAULT_CREATION_OPTIONS`), правки — `ValidAnnotatedEditOperation`
// без флагов, снапшот — `createSnapshot(false)`.

import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Range } from "../../common/core/range.ts";
import type { ITextBuffer, ITextSnapshot } from "../../common/model.ts";
import { DefaultEndOfLine, ValidAnnotatedEditOperation } from "../../common/model.ts";
import { PieceTreeTextBufferBuilder } from "../../common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.ts";

export interface ITestTextModelEdit {
    readonly range: Range;
    readonly text: string;
}

export interface ITestTextModel extends IDisposable {
    applyEdits(operations: readonly ITestTextModelEdit[]): void;
    createSnapshot(): ITextSnapshot;
    getLinesContent(): string[];
}

class TestTextModel implements ITestTextModel {
    public constructor(
        private readonly buffer: ITextBuffer,
        private readonly disposable: IDisposable,
    ) {}

    public applyEdits(operations: readonly ITestTextModelEdit[]): void {
        this.buffer.applyEdits(
            operations.map((op) => new ValidAnnotatedEditOperation(null, op.range, op.text, false, false, false)),
            false,
            false,
        );
    }

    public createSnapshot(): ITextSnapshot {
        return this.buffer.createSnapshot(false);
    }

    public getLinesContent(): string[] {
        return this.buffer.getLinesContent();
    }

    public dispose(): void {
        this.disposable.dispose();
    }
}

export function createTextModel(text: string): ITestTextModel {
    const builder = new PieceTreeTextBufferBuilder();
    builder.acceptChunk(text);
    const { textBuffer, disposable } = builder.finish().create(DefaultEndOfLine.LF);
    return new TestTextModel(textBuffer, disposable);
}
