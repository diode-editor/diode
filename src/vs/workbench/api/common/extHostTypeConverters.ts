/**
 * Mirrors upstream `extHostTypeConverters.ts`. The host does not re-validate subprocess
 * responses: this module guarantees the shape; extension objects are checked by duck
 * typing: fields are writable, and the object itself may come from a foreign bundle.
 */
import type * as vscode from "vscode";

import { comparePositions, createPosition, type IPosition } from "../../../editor/common/core/iPosition.ts";
import { createRange, type IRange } from "../../../editor/common/core/iRange.ts";
import type { IColor, IColorInformation } from "../../../editor/common/languages/iColorSource.ts";
import type { ICoreCompletionItem } from "../../../editor/common/languages/iCompletionSource.ts";
import type { ICoreDefinitionLocation } from "../../../editor/common/languages/iDefinitionSource.ts";
import type { ICoreInlineCompletionItem } from "../../../editor/common/languages/iInlineCompletionSource.ts";
import type {
    ICoreParameterInfo,
    ICoreSignature,
    ICoreSignatureHelp,
} from "../../../editor/common/languages/iSignatureHelpSource.ts";

import type { ExtHostTextDocument } from "./extHostDocuments.ts";
import {
    Diagnostic,
    EndOfLine,
    ParameterInformation,
    Position,
    Range,
    Selection,
    SignatureHelp,
    SignatureInformation,
    SnippetString,
    SnippetTextEdit,
    type TextEdit,
    type WorkspaceEdit,
} from "./vscodeTypes.ts";
import type {
    IWireEditorEdit,
    IWireInlayHint,
    IWireSelection,
    IWireWorkspaceEditOp,
    SerializedColor,
    SerializedDecorationRenderOptions,
    WireFoldingRange,
    WireMarker,
    WireRenamePrepare,
    WireTextEdit,
} from "./wireTypes.ts";

function isFiniteNumber(raw: unknown): raw is number {
    return Number.isFinite(raw);
}

/**
 * An inverted range is flipped: the `Range` constructor keeps `start <= end`,
 * a duck-typed object does not. `Position` clamps to zero but lets `NaN` through.
 */
export function rangeFrom(raw: unknown): IRange | null {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown; character?: unknown } };
    const { start, end } = r;
    if (
        start == null ||
        end == null ||
        !isFiniteNumber(start.line) ||
        !isFiniteNumber(start.character) ||
        !isFiniteNumber(end.line) ||
        !isFiniteNumber(end.character)
    ) {
        return null;
    }
    const from = createPosition(start.line, start.character);
    const to = createPosition(end.line, end.character);
    // Stryker disable next-line EqualityOperator: on equal bounds both branches produce the same range
    return comparePositions(from, to) <= 0 ? { start: from, end: to } : { start: to, end: from };
}

export function toVscodeRange(range: IRange): Range {
    return new Range(range.start.line, range.start.character, range.end.line, range.end.character);
}

/** A broken range is dropped, just as the host's decoration parsing would drop it. */
export function normalizeDecorationRanges(
    rangesOrOptions: readonly vscode.Range[] | readonly vscode.DecorationOptions[],
): IRange[] {
    return rangesOrOptions.flatMap((item) => {
        const range = rangeFrom("range" in item ? item.range : item);
        return range === null ? [] : [range];
    });
}

export function toVscodeSelection(s: IWireSelection): vscode.Selection {
    return new Selection(new Position(s.anchorLine, s.anchorCharacter), new Position(s.activeLine, s.activeCharacter));
}

export function toWireSelection(selection: vscode.Selection): IWireSelection {
    return {
        anchorLine: selection.anchor.line,
        anchorCharacter: selection.anchor.character,
        activeLine: selection.active.line,
        activeCharacter: selection.active.character,
    };
}

export function toWireEditRange(location: vscode.Range | vscode.Position): IRange | null {
    const asRange = location as { start?: vscode.Position; end?: vscode.Position };
    if (asRange.start !== undefined && asRange.end !== undefined) {
        return rangeFrom(location);
    }
    const pos = location as vscode.Position;
    return createRange(pos.line, pos.character, pos.line, pos.character);
}

export function serializeColor(value: unknown): SerializedColor | undefined {
    if (typeof value === "string") return value;
    if (typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string") {
        return { $themeColor: (value as { id: string }).id };
    }
    return undefined;
}

export function serializeDecorationRenderOptions(options: unknown): SerializedDecorationRenderOptions {
    const o = (typeof options === "object" && options !== null ? options : {}) as {
        isWholeLine?: unknown;
        overviewRulerLane?: unknown;
        backgroundColor?: unknown;
        color?: unknown;
        overviewRulerColor?: unknown;
    };
    const result: {
        isWholeLine?: boolean;
        overviewRulerLane?: number;
        backgroundColor?: SerializedColor;
        color?: SerializedColor;
        overviewRulerColor?: SerializedColor;
    } = {};
    if (typeof o.isWholeLine === "boolean") result.isWholeLine = o.isWholeLine;
    if (typeof o.overviewRulerLane === "number") result.overviewRulerLane = o.overviewRulerLane;
    const bg = serializeColor(o.backgroundColor);
    if (bg !== undefined) result.backgroundColor = bg;
    const color = serializeColor(o.color);
    if (color !== undefined) result.color = color;
    const overview = serializeColor(o.overviewRulerColor);
    if (overview !== undefined) result.overviewRulerColor = overview;
    return result;
}

/** A blind `String()` would put "[object Object]" into the marker here. */
function messageText(message: unknown): string {
    // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent — without this branch the string goes to the final `toString()`, which returns the string itself; the branch is for the types and the reader
    if (typeof message === "string") return message;
    if (message === undefined || message === null) return "";
    if (typeof message === "object") {
        const value = (message as { value?: unknown }).value;
        return typeof value === "string" ? value : "";
    }
    return (message as { toString(): string }).toString();
}

/** No branch for strings is needed: their `toString()` is the string itself. */
function uriText(uri: unknown): string {
    return (uri as { toString(): string }).toString();
}

/**
 * No `range` means the start of the file; a broken range → `null`: the marker is dropped, as
 * in the host's parsing, instead of crashing the extension's `collection.set`.
 */
export function toWireMarker(diag: unknown): WireMarker | null {
    const d = diag as {
        range?: unknown;
        message?: unknown;
        severity?: unknown;
        code?: unknown;
        source?: unknown;
    };
    const range = d.range == null ? createRange(0, 0, 0, 0) : rangeFrom(d.range);
    if (range === null) return null;
    // The rich `{ value, target }` form (eslint sends it): the TUI has nowhere to open target.
    const rawCode = typeof d.code === "object" && d.code !== null ? (d.code as { value?: unknown }).value : d.code;
    const code = typeof rawCode === "string" || typeof rawCode === "number" ? String(rawCode) : undefined;
    return {
        severity: typeof d.severity === "number" ? d.severity : 0,
        range,
        message: messageText(d.message),
        ...(code !== undefined ? { code } : {}),
        ...(typeof d.source === "string" ? { source: d.source } : {}),
    };
}

/** Like upstream `Diagnostic.to`. */
export function toVscodeDiagnostic(marker: WireMarker): vscode.Diagnostic {
    const diag = new Diagnostic(toVscodeRange(marker.range), marker.message, marker.severity);
    diag.code = marker.code;
    diag.source = marker.source;
    return diag;
}

export function serializeDefinitionLocation(item: unknown): ICoreDefinitionLocation | null {
    if (typeof item !== "object" || item === null) return null;
    const link = item as { targetUri?: unknown; targetRange?: unknown; targetSelectionRange?: unknown };
    if (link.targetUri != null) {
        return serializeLocation(link.targetUri, link.targetSelectionRange ?? link.targetRange);
    }
    const loc = item as { uri?: unknown; range?: unknown };
    if (loc.uri == null) return null;
    return serializeLocation(loc.uri, loc.range);
}

function serializeLocation(rawUri: unknown, rawRange: unknown): ICoreDefinitionLocation | null {
    const uri = uriText(rawUri);
    const range = rangeFrom(rawRange);
    return range === null || uri === "" ? null : { uri, range };
}

/**
 * A missing placeholder is filled from the range text (as upstream promises):
 * only the subprocess has the document.
 */
export function serializeRenamePrepare(raw: unknown, doc: ExtHostTextDocument): WireRenamePrepare | null {
    // The shape is not checked: the caller rejects `null`/`undefined`, range parsing rejects primitives.
    const holder = raw as { range?: unknown; placeholder?: unknown };
    const rangeSource = holder.range === undefined ? raw : holder.range;
    const range = rangeFrom(rangeSource);
    if (range === null) return null;
    if (typeof holder.placeholder === "string" && holder.placeholder !== "") {
        return { placeholder: holder.placeholder };
    }
    const text = doc.getText(toVscodeRange(range));
    // Empty range: the core fills in the word under the cursor.
    return text === "" ? null : { placeholder: text };
}

/** Markup is left as is: the UI consumer strips it. */
export function serializeHoverContents(raw: unknown): string[] {
    const blocks: string[] = [];
    for (const block of Array.isArray(raw) ? raw : [raw]) {
        const value = readHoverBlock(block);
        if (value !== null && value.trim() !== "") blocks.push(value);
    }
    return blocks;
}

function readHoverBlock(block: unknown): string | null {
    if (typeof block === "string") return block;
    if (block === null) return null;
    const b = block as { value?: unknown; language?: unknown };
    if (typeof b.value !== "string") return null;
    // Legacy `MarkedString` goes into a fence so the UI can tell code from prose.
    if (typeof b.language !== "string" || b.language === "") return b.value;
    return `\`\`\`${b.language}\n${b.value}\n\`\`\``;
}

/**
 * Parsing is strict: a broken signature or parameter rejects the whole response, since
 * dropping one element would silently shift the `activeSignature`/`activeParameter` indices.
 */
export function serializeSignatureHelp(raw: unknown): ICoreSignatureHelp | null {
    if (typeof raw !== "object" || raw === null) return null;
    const help = raw as { signatures?: unknown; activeSignature?: unknown; activeParameter?: unknown };
    if (!Array.isArray(help.signatures) || help.signatures.length === 0) return null;

    const signatures: ICoreSignature[] = [];
    for (const item of help.signatures) {
        const signature = serializeSignature(item);
        if (signature === null) return null;
        signatures.push(signature);
    }

    return {
        signatures,
        activeSignature: clampSignatureIndex(help.activeSignature, signatures.length),
        // `-1` is a legal "no active parameter"; there is no lower bound.
        activeParameter: isFiniteNumber(help.activeParameter) ? help.activeParameter : 0,
    };
}

function clampSignatureIndex(raw: unknown, length: number): number {
    if (!Number.isInteger(raw)) return 0;
    const index = raw as number;
    // Stryker disable next-line EqualityOperator: at index === 0 both bounds give zero — the same index as without the clamp
    if (index < 0 || index >= length) return 0;
    return index;
}

function serializeSignature(raw: unknown): ICoreSignature | null {
    if (!isDuckObject(raw)) return null;
    const item = raw as { label?: unknown; documentation?: unknown; parameters?: unknown; activeParameter?: unknown };
    if (typeof item.label !== "string") return null;

    const parameters: ICoreParameterInfo[] = [];
    if (item.parameters !== undefined) {
        if (!Array.isArray(item.parameters)) return null;
        for (const parameter of item.parameters) {
            const serialized = serializeParameter(parameter);
            if (serialized === null) return null;
            parameters.push(serialized);
        }
    }

    const documentation = readDocumentationText(item.documentation);
    return {
        label: item.label,
        parameters,
        ...(documentation === undefined || documentation === "" ? {} : { documentation }),
        ...(isFiniteNumber(item.activeParameter) ? { activeParameter: item.activeParameter } : {}),
    };
}

function serializeParameter(raw: unknown): ICoreParameterInfo | null {
    if (!isDuckObject(raw)) return null;
    const item = raw as { label?: unknown; documentation?: unknown };
    const label = serializeParameterLabel(item.label);
    if (label === null) return null;
    const documentation = readDocumentationText(item.documentation);
    return { label, ...(documentation === undefined || documentation === "" ? {} : { documentation }) };
}

/** A separate function so the runtime-redundant `typeof` conjunct is suppressed in one place. */
function isDuckObject(raw: unknown): boolean {
    if (raw === null) return false;
    // Stryker disable next-line ConditionalExpression: see above — the callers' field checks filter out primitives
    return typeof raw === "object";
}

/** Offsets are a half-open interval `[start, end)`. */
function serializeParameterLabel(raw: unknown): string | readonly [number, number] | null {
    if (typeof raw === "string") return raw;
    if (!Array.isArray(raw) || raw.length !== 2) return null;
    const [start, end] = raw as unknown[];
    if (!isFiniteNumber(start) || !isFiniteNumber(end)) return null;
    return [start, end];
}

/** The shape is not checked: this is an echo of the core's own hint. */
export function toVscodeSignatureHelp(help: ICoreSignatureHelp): SignatureHelp {
    const result = new SignatureHelp();
    result.signatures = help.signatures.map(toVscodeSignature);
    result.activeSignature = help.activeSignature;
    result.activeParameter = help.activeParameter;
    return result;
}

function toVscodeSignature(signature: ICoreSignature): SignatureInformation {
    const info = new SignatureInformation(signature.label, signature.documentation);
    info.parameters = signature.parameters.map(
        (parameter) =>
            new ParameterInformation(
                typeof parameter.label === "string" ? parameter.label : [parameter.label[0], parameter.label[1]],
                parameter.documentation,
            ),
    );
    info.activeParameter = signature.activeParameter;
    return info;
}

function readLabel(item: vscode.CompletionItem): string | undefined {
    const label = (item as { label?: unknown }).label;
    if (typeof label === "string") return label;
    if (typeof label === "object" && label !== null && typeof (label as { label?: unknown }).label === "string") {
        return (label as { label: string }).label;
    }
    return undefined;
}

function readLabelDetails(item: vscode.CompletionItem): { detail?: string; description?: string } {
    const label = (item as { label?: unknown }).label;
    if (typeof label !== "object" || label === null) return {};
    const parts = label as { detail?: unknown; description?: unknown };
    return {
        ...(typeof parts.detail === "string" ? { detail: parts.detail } : {}),
        ...(typeof parts.description === "string" ? { description: parts.description } : {}),
    };
}

/**
 * There are no snippet sessions: this is a safeguard so that `${1:name}` does not end up
 * in the buffer, not snippet support.
 */
export function stripSnippetPlaceholders(value: string): string {
    // The escaped `\$` is hidden FIRST: otherwise `\$5` parses as the placeholder
    // `$5`, leaving an orphaned backslash behind.
    const ESCAPED_DOLLAR = "\u0000";
    return (
        value
            .replace(/\\\$/g, ESCAPED_DOLLAR)
            // `split(",", 1).join("")` instead of `[0]`: yields the first choice without an
            // "array might be empty" branch (it never is, and covering it would need a test).
            .replace(/\$\{(\d+)\|([^|]*)\|\}/g, (_all, _index: string, choices: string) =>
                // Stryker disable next-line StringLiteral: equivalent `join` separator — `split(…, 1)` always yields exactly one element, nothing to join; mutating the `split` separator is covered by the "${1|foo,bar|}" test
                choices.split(",", 1).join(""),
            )
            .replace(/\$\{\d+:([^}]*)\}/g, "$1")
            .replace(/\$\{\d+\}/g, "")
            .replace(/\$\d+/g, "")
            .replaceAll(ESCAPED_DOLLAR, "$")
    );
}

function readInsertText(item: vscode.CompletionItem, label: string): string {
    const insert = (item as { insertText?: unknown }).insertText;
    if (typeof insert === "string") return insert;
    if (insert instanceof SnippetString) return stripSnippetPlaceholders(insert.value);
    if (typeof insert === "object" && insert !== null && typeof (insert as { value?: unknown }).value === "string") {
        return (insert as { value: string }).value;
    }
    return label;
}

export function readDocumentation(item: vscode.CompletionItem): string | undefined {
    return readDocumentationText((item as { documentation?: unknown }).documentation);
}

function readDocumentationText(doc: unknown): string | undefined {
    if (typeof doc === "string") return doc;
    if (typeof doc === "object" && doc !== null && typeof (doc as { value?: unknown }).value === "string") {
        return (doc as { value: string }).value;
    }
    return undefined;
}

/** By shape, not `instanceof`: a `Range` from a foreign bundle is a range too. */
function readRange(item: vscode.CompletionItem): IRange | undefined {
    const raw = (item as { range?: unknown }).range;
    if (raw === undefined || raw === null) return undefined;
    const replacing = (raw as { replacing?: unknown }).replacing;
    return rangeFrom(replacing === undefined ? raw : replacing) ?? undefined;
}

/** `id` is the item key in the response cache; the host resolves the item by it later. */
export function serializeCompletionItem(item: vscode.CompletionItem, id: string): ICoreCompletionItem | null {
    const label = readLabel(item);
    if (label === undefined || label === "") return null;
    const labelDetails = readLabelDetails(item);
    const command = (item as { command?: { command?: unknown; arguments?: unknown } | null }).command;
    const kind = (item as { kind?: unknown }).kind;
    const detail = (item as { detail?: unknown }).detail;
    const sortText = (item as { sortText?: unknown }).sortText;
    const filterText = (item as { filterText?: unknown }).filterText;
    const documentation = readDocumentation(item);
    const range = readRange(item);
    const additionalEdits = readAdditionalTextEdits(item);
    return {
        label,
        insertText: readInsertText(item, label),
        id,
        ...(labelDetails.detail !== undefined ? { labelDetail: labelDetails.detail } : {}),
        ...(labelDetails.description !== undefined ? { labelDescription: labelDetails.description } : {}),
        ...(isFiniteNumber(kind) ? { kind } : {}),
        ...(typeof detail === "string" ? { detail } : {}),
        ...(documentation !== undefined ? { documentation } : {}),
        ...(typeof command?.command === "string" && command.command !== ""
            ? {
                  command: {
                      command: command.command,
                      ...(Array.isArray(command.arguments) ? { arguments: command.arguments } : {}),
                  },
              }
            : {}),
        ...(range !== undefined ? { range } : {}),
        ...(typeof sortText === "string" ? { sortText } : {}),
        ...(typeof filterText === "string" ? { filterText } : {}),
        ...(additionalEdits.length > 0 ? { additionalEdits } : {}),
    };
}

export function readAdditionalTextEdits(item: vscode.CompletionItem): IWireEditorEdit[] {
    const raw = (item as { additionalTextEdits?: unknown }).additionalTextEdits;
    const edits: IWireEditorEdit[] = [];
    if (!Array.isArray(raw)) return edits;
    for (const edit of raw) {
        const wire = serializeTextEdit(edit);
        if (wire !== null) edits.push(wire);
    }
    return edits;
}

export function serializeInlineCompletionItem(item: unknown): ICoreInlineCompletionItem | null {
    // The typeof clause is defensive: a non-object without .insertText is filtered out by the next
    // guard (a primitive with a string insertText is impossible), so its mutants
    // are equivalent. null is rejected for real (the field access would throw).
    // Stryker disable next-line ConditionalExpression: see above
    if (typeof item !== "object" || item === null) return null;
    const obj = item as { insertText?: unknown; filterText?: unknown; range?: unknown };
    let insertText: string;
    if (typeof obj.insertText === "string") {
        insertText = obj.insertText;
    } else if (obj.insertText instanceof SnippetString) {
        insertText = stripSnippetPlaceholders(obj.insertText.value);
    } else {
        return null;
    }
    if (insertText === "") return null;
    const range = rangeFrom(obj.range);
    return {
        insertText,
        ...(typeof obj.filterText === "string" ? { filterText: obj.filterText } : {}),
        ...(range === null ? {} : { range }),
    };
}

export function serializeTextEdit(edit: unknown): IWireEditorEdit | null {
    if (typeof edit !== "object" || edit === null) return null;
    const e = edit as { range?: unknown; newText?: unknown };
    const range = rangeFrom(e.range);
    if (range === null || typeof e.newText !== "string") return null;
    return { range, text: e.newText };
}

export function serializeFoldingRange(range: vscode.FoldingRange): WireFoldingRange | null {
    const start = (range as { start?: unknown }).start;
    const end = (range as { end?: unknown }).end;
    // The typeof clause is for type narrowing: a non-number fails
    // `Number.isFinite` anyway, so replacing it with `false` is equivalent.
    // Stryker disable next-line ConditionalExpression: see above
    if (typeof start !== "number" || !Number.isFinite(start)) return null;
    // Stryker disable next-line ConditionalExpression: see above
    if (typeof end !== "number" || !Number.isFinite(end)) return null;
    const kind = (range as { kind?: unknown }).kind;
    return {
        start,
        end,
        ...(isFiniteNumber(kind) ? { kind } : {}),
    };
}

/**
 * Like upstream `SelectionRangeAdapter`: a response that does not cover every position, or a step
 * that does not contain the previous one, rejects the whole response. A cyclic `parent` is cut at the repeat.
 */
export function serializeSelectionRanges(raw: unknown, positions: readonly IPosition[]): IRange[][] {
    if (!Array.isArray(raw) || raw.length !== positions.length) return [];
    const result: IRange[][] = [];
    for (let i = 0; i < positions.length; i++) {
        const chain: IRange[] = [];
        let last: IRange = { start: positions[i], end: positions[i] };
        const seen = new Set<unknown>();
        let node: unknown = raw[i];
        while (typeof node === "object" && node !== null && !seen.has(node)) {
            seen.add(node);
            const range = rangeFrom((node as { range?: unknown }).range);
            if (range === null || !containsRange(range, last)) return [];
            chain.push(range);
            last = range;
            node = (node as { parent?: unknown }).parent;
        }
        result.push(chain);
    }
    return result;
}

function containsRange(outer: IRange, inner: IRange): boolean {
    return comparePositions(outer.start, inner.start) <= 0 && comparePositions(inner.end, outer.end) <= 0;
}

/** A channel outside [0, 1] is clamped; not a number (NaN included) — `null`, the color is dropped. */
function colorChannel(raw: unknown): number | null {
    if (typeof raw !== "number" || Number.isNaN(raw)) return null;
    return Math.min(1, Math.max(0, raw));
}

function colorFrom(raw: unknown): IColor | null {
    const c = (raw ?? {}) as Partial<Record<keyof IColor, unknown>>;
    const red = colorChannel(c.red);
    const green = colorChannel(c.green);
    const blue = colorChannel(c.blue);
    const alpha = colorChannel(c.alpha);
    if (red === null || green === null || blue === null || alpha === null) return null;
    return { red, green, blue, alpha };
}

/**
 * Upstream `ColorProviderAdapter.provideColors`. Deviation from upstream: an empty answer (or not an
 * array) is `null`, "no colors": in `auto` mode the default detector keeps working, as the spec of
 * #884 asks; upstream silences it by the mere registration of a provider for the document. A broken
 * entry is dropped, not the whole answer.
 */
export function serializeDocumentColors(raw: unknown): IColorInformation[] | null {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const colors: IColorInformation[] = [];
    for (const item of raw as unknown[]) {
        const info = (item ?? {}) as { range?: unknown; color?: unknown };
        const range = rangeFrom(info.range);
        const color = colorFrom(info.color);
        if (range !== null && color !== null) colors.push({ range, color });
    }
    return colors;
}

/** Part fields other than `value` have nothing to draw them yet. `null` is a label upstream calls invalid. */
function inlayHintLabelFrom(raw: unknown): IWireInlayHint["label"] | null {
    if (typeof raw === "string") return raw === "" ? null : raw;
    if (!Array.isArray(raw)) return null;
    const parts = (raw as unknown[]).map((part) => ({ value: (part as { value?: unknown } | null)?.value }));
    const valid = parts.filter((part): part is { value: string } => typeof part.value === "string");
    return valid.some((part) => part.value !== "") ? valid : null;
}

function inlayHintFrom(raw: unknown, range: IRange): IWireInlayHint | null {
    const hint = (raw ?? {}) as {
        position?: { line?: unknown; character?: unknown };
        label?: unknown;
        kind?: unknown;
        paddingLeft?: unknown;
        paddingRight?: unknown;
    };
    const label = inlayHintLabelFrom(hint.label);
    const line = hint.position?.line;
    const character = hint.position?.character;
    if (label === null || !isFiniteNumber(line) || !isFiniteNumber(character)) return null;
    const position = createPosition(line, character);
    if (comparePositions(position, range.start) < 0 || comparePositions(position, range.end) > 0) return null;
    return {
        position,
        label,
        // The host validates the kind: it drops the one hint with an unknown value.
        ...(hint.kind === undefined || hint.kind === null ? {} : { kind: hint.kind as 1 | 2 }),
        ...(hint.paddingLeft === true ? { paddingLeft: true } : {}),
        ...(hint.paddingRight === true ? { paddingRight: true } : {}),
    };
}

/**
 * Upstream `InlayHintsAdapter.provideInlayHints` without the resolve cache: an empty label or a position outside
 * the requested range costs that one hint (`_isValidInlayHint`). No hints at all is `null`.
 */
export function serializeInlayHints(raw: unknown, range: IRange): IWireInlayHint[] | null {
    if (!Array.isArray(raw)) return null;
    const hints = (raw as unknown[]).map((item) => inlayHintFrom(item, range)).filter((hint) => hint !== null);
    return hints.length === 0 ? null : hints;
}

/** Edit fields are public and writable, and the host does not re-validate the will-save response. */
export function serializeWillSaveTextEdit(edit: TextEdit): WireTextEdit | null {
    if (edit.newEol !== undefined) {
        return { setEndOfLine: edit.newEol === EndOfLine.CRLF ? 2 : 1 };
    }
    return serializeTextEdit(edit);
}

/** A snippet edit becomes text (no tab stops); a pure EOL edit becomes `null`. */
function serializeWorkspaceTextEdit(edit: TextEdit | SnippetTextEdit, range: IRange): IWireEditorEdit | null {
    if (edit instanceof SnippetTextEdit) {
        return { range, text: stripSnippetPlaceholders(edit.snippet.value) };
    }
    if (edit.newEol !== undefined && edit.newText === "" && edit.range.isEmpty) return null;
    return { range, text: edit.newText };
}

/**
 * The order of operations is kept verbatim: "Move to a new file" creates the file and writes
 * to it right away. An operation where ALL edits turn out broken is a refusal of the whole edit
 * (`null`), as the host's parsing would reject it.
 */
export function serializeWorkspaceEdit(edit: WorkspaceEdit): IWireWorkspaceEditOp[] | null {
    const ops: IWireWorkspaceEditOp[] = [];
    for (const op of edit.operations()) {
        if (op.kind === "text") {
            const edits: IWireEditorEdit[] = [];
            let broken = false;
            let setEndOfLine: 1 | 2 | undefined;
            for (const item of op.edits) {
                if (!(item instanceof SnippetTextEdit) && item.newEol !== undefined) {
                    setEndOfLine = item.newEol === EndOfLine.CRLF ? 2 : 1;
                }
                const range = rangeFrom(item.range);
                if (range === null) {
                    broken = true;
                    continue;
                }
                const serialized = serializeWorkspaceTextEdit(item, range);
                if (serialized !== null) edits.push(serialized);
            }
            if (edits.length === 0 && broken) return null;
            ops.push({
                kind: "text",
                resource: op.uri.toString(),
                edits,
                ...(setEndOfLine === undefined ? {} : { setEndOfLine }),
            });
            continue;
        }
        if (op.kind === "rename") {
            ops.push({
                kind: "rename",
                from: op.from.toString(),
                to: op.to.toString(),
                ...(op.options.overwrite === undefined ? {} : { overwrite: op.options.overwrite }),
                ...(op.options.ignoreIfExists === true ? { ignoreIfExists: true } : {}),
            });
            continue;
        }
        if (op.kind === "create") {
            ops.push({
                kind: "create",
                resource: op.uri.toString(),
                ...(op.options.contents === undefined ? {} : { contents: op.options.contents }),
                ...(op.options.contentsBase64 === undefined ? {} : { contentsBase64: op.options.contentsBase64 }),
                ...(op.options.overwrite === undefined ? {} : { overwrite: op.options.overwrite }),
                ...(op.options.ignoreIfExists === true ? { ignoreIfExists: true } : {}),
            });
            continue;
        }
        ops.push({
            kind: "delete",
            resource: op.uri.toString(),
            ...(op.options.ignoreIfNotExists === true ? { ignoreIfNotExists: true } : {}),
        });
    }
    return ops;
}
