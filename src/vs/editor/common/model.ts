/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/editor/common/model.ts
// Narrow extraction: `ITextModel` for model/textModelTokens.ts (adapter:
// tokens/documentTokenStore.ts) and the buffer contract for pieceTreeTextBuffer/*,
// verbatim from upstream. Coordinates are 1-based; ±1 only in adapters (docs/arch/Editor.md).

import type { Event } from "../../base/common/event.ts";
import type { IDisposable } from "../../base/common/lifecycle.ts";

import type { ISingleEditOperation } from "./core/editOperation.ts";
import type { Position } from "./core/position.ts";
import type { Range } from "./core/range.ts";
import type { TextChange } from "./core/textChange.ts";
import type { WordCharacterClassifier } from "./core/wordCharacterClassifier.ts";
import type { IModelContentChange } from "./model/mirrorTextModel.ts";

export interface ITextModel {
    getLanguageId(): string;
    getLineCount(): number;
    getLineContent(lineNumber: number): string;
    getLineLength(lineNumber: number): number;
    /** 0 when the line is empty or whitespace only. */
    getLineFirstNonWhitespaceColumn(lineNumber: number): number;
    isAttachedToEditor(): boolean;
}

/**
 * End of line character preference.
 */
export const enum EndOfLinePreference {
    /**
     * Use the end of line character identified in the text buffer.
     */
    TextDefined = 0,
    /**
     * Use line feed (\n) as the end of line character.
     */
    LF = 1,
    /**
     * Use carriage return and line feed (\r\n) as the end of line character.
     */
    CRLF = 2,
}

/**
 * The default end of line to use when instantiating models.
 */
export const enum DefaultEndOfLine {
    /**
     * Use line feed (\n) as the end of line character.
     */
    LF = 1,
    /**
     * Use carriage return and line feed (\r\n) as the end of line character.
     */
    CRLF = 2,
}

/**
 * An identifier for a single edit operation.
 * @internal
 */
export interface ISingleEditOperationIdentifier {
    /**
     * Identifier major
     */
    major: number;
    /**
     * Identifier minor
     */
    minor: number;
}

/**
 * A single edit operation, that has an identifier.
 */
export interface IIdentifiedSingleEditOperation extends ISingleEditOperation {
    /**
     * An identifier associated with this single edit operation.
     * @internal
     */
    identifier?: ISingleEditOperationIdentifier | null;
    /**
     * This indicates that this operation is inserting automatic whitespace
     * that can be removed on next model edit operation if `config.trimAutoWhitespace` is true.
     * @internal
     */
    isAutoWhitespaceEdit?: boolean;
    /**
     * This indicates that this operation is in a set of operations that are tracked and should not be "simplified".
     * @internal
     */
    _isTracked?: boolean;
}

export interface IValidEditOperation {
    /**
     * An identifier associated with this single edit operation.
     * @internal
     */
    identifier: ISingleEditOperationIdentifier | null;
    /**
     * The range to replace. This can be empty to emulate a simple insert.
     */
    range: Range;
    /**
     * The text to replace with. This can be empty to emulate a simple delete.
     */
    text: string;
    /**
     * @internal
     */
    textChange: TextChange;
}

export class FindMatch {
    public _findMatchBrand = undefined;

    public readonly range: Range;
    public readonly matches: string[] | null;

    /**
     * @internal
     */
    public constructor(range: Range, matches: string[] | null) {
        this.range = range;
        this.matches = matches;
    }
}

/**
 * Text snapshot that works like an iterator.
 * Will try to return chunks of roughly ~64KB size.
 * Will return null when finished.
 */
export interface ITextSnapshot {
    read(): string | null;
}

/**
 * @internal
 */
export interface ITextBufferBuilder {
    acceptChunk(chunk: string): void;
    finish(): ITextBufferFactory;
}

/**
 * @internal
 */
export interface ITextBufferFactory {
    create(defaultEOL: DefaultEndOfLine): { textBuffer: ITextBuffer; disposable: IDisposable };
    getFirstLineText(lengthLimit: number): string;
}

/**
 * @internal
 */
export class ValidAnnotatedEditOperation implements IIdentifiedSingleEditOperation {
    public constructor(
        public readonly identifier: ISingleEditOperationIdentifier | null,
        public readonly range: Range,
        public readonly text: string | null,
        public readonly forceMoveMarkers: boolean,
        public readonly isAutoWhitespaceEdit: boolean,
        public readonly _isTracked: boolean,
    ) {}
}

/**
 * @internal
 *
 * `lineNumber` is 1 based.
 */
export interface IReadonlyTextBuffer {
    readonly onDidChangeContent: Event<void>;
    equals(other: ITextBuffer): boolean;
    mightContainRTL(): boolean;
    mightContainUnusualLineTerminators(): boolean;
    resetMightContainUnusualLineTerminators(): void;
    mightContainNonBasicASCII(): boolean;
    getBOM(): string;
    getEOL(): string;

    getOffsetAt(lineNumber: number, column: number): number;
    getPositionAt(offset: number): Position;
    getRangeAt(offset: number, length: number): Range;

    getValueInRange(range: Range, eol: EndOfLinePreference): string;
    createSnapshot(preserveBOM: boolean): ITextSnapshot;
    getValueLengthInRange(range: Range, eol: EndOfLinePreference): number;
    getCharacterCountInRange(range: Range, eol: EndOfLinePreference): number;
    getLength(): number;
    getLineCount(): number;
    getLinesContent(): string[];
    getLineContent(lineNumber: number): string;
    getLineCharCode(lineNumber: number, index: number): number;
    getCharCode(offset: number): number;
    getLineLength(lineNumber: number): number;
    getLineMinColumn(lineNumber: number): number;
    getLineMaxColumn(lineNumber: number): number;
    getLineFirstNonWhitespaceColumn(lineNumber: number): number;
    getLineLastNonWhitespaceColumn(lineNumber: number): number;
    findMatchesLineByLine(
        searchRange: Range,
        searchData: SearchData,
        captureMatches: boolean,
        limitResultCount: number,
    ): FindMatch[];

    /**
     * Get nearest chunk of text after `offset` in the text buffer.
     */
    getNearestChunk(offset: number): string;
}

/**
 * @internal
 */
export class SearchData {
    /**
     * The regex to search for. Always defined.
     */
    public readonly regex: RegExp;
    /**
     * The word separator classifier.
     */
    public readonly wordSeparators: WordCharacterClassifier | null;
    /**
     * The simple string to search for (if possible).
     */
    public readonly simpleSearch: string | null;

    public constructor(regex: RegExp, wordSeparators: WordCharacterClassifier | null, simpleSearch: string | null) {
        this.regex = regex;
        this.wordSeparators = wordSeparators;
        this.simpleSearch = simpleSearch;
    }
}

/**
 * @internal
 */
export interface ITextBuffer extends IReadonlyTextBuffer, IDisposable {
    setEOL(newEOL: "\r\n" | "\n"): void;
    applyEdits(
        rawOperations: ValidAnnotatedEditOperation[],
        recordTrimAutoWhitespace: boolean,
        computeUndoEdits: boolean,
    ): ApplyEditsResult;
}

/**
 * @internal
 */
export class ApplyEditsResult {
    public constructor(
        public readonly reverseEdits: IValidEditOperation[] | null,
        public readonly changes: IInternalModelContentChange[],
        public readonly trimAutoWhitespaceLineNumbers: number[] | null,
    ) {}
}

/**
 * @internal
 */
export interface IInternalModelContentChange extends IModelContentChange {
    range: Range;
    forceMoveMarkers: boolean;
}
