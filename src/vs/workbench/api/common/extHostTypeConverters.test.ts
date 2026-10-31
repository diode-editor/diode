import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import {
    normalizeDecorationRanges,
    rangeFrom,
    readDocumentation,
    serializeColor,
    serializeCompletionItem,
    serializeDecorationRenderOptions,
    serializeFoldingRange,
    serializeTextEdit,
    serializeWillSaveTextEdit,
    serializeWorkspaceEdit,
    stripSnippetPlaceholders,
    toVscodeRange,
    toVscodeSelection,
    toVscodeSignatureHelp,
    toWireEditRange,
    toWireMarker,
    toWireSelection,
} from "./extHostTypeConverters.ts";
import {
    CompletionItem,
    EndOfLine,
    ParameterInformation,
    Position,
    Range,
    Selection,
    SignatureHelp,
    SignatureInformation,
    SnippetString,
    SnippetTextEdit,
    TextEdit,
    Uri,
    WorkspaceEdit,
} from "./vscodeTypes.ts";

const RANGE = { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } };
/** The same shape as a foreign duck-typed object (another bundle of `vscode` types). */
const FOREIGN = { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } };
const REVERSED = { start: { line: 0, character: 2 }, end: { line: 0, character: 1 } };
const SHAPELESS = { line: 0 };
/** `Position` clamps to zero but lets `NaN` through. */
const NAN_RANGE = new Range(NaN, 1, 0, 2);
const URI_A = Uri.file("/proj/a.ts");

describe("rangeFrom", () => {
    it("an extension Range becomes a core IRange of plain objects, without the Position prototype", () => {
        const range = rangeFrom(new Range(1, 2, 3, 4));
        expect(range).toStrictEqual({ start: { line: 1, character: 2 }, end: { line: 3, character: 4 } });
    });

    it("a foreign duck-typed Range (another bundle, extra fields) is accepted by shape", () => {
        const foreign = {
            start: { line: 0, character: 1, extra: true },
            end: { line: 0, character: 2 },
            isEmpty: false,
        };
        expect(rangeFrom(foreign)).toStrictEqual(RANGE);
    });

    it("a reversed range is flipped: by line and by character within one line", () => {
        expect(rangeFrom({ start: { line: 3, character: 0 }, end: { line: 1, character: 5 } })).toStrictEqual({
            start: { line: 1, character: 5 },
            end: { line: 3, character: 0 },
        });
        expect(rangeFrom({ start: { line: 0, character: 2 }, end: { line: 0, character: 1 } })).toStrictEqual(RANGE);
    });

    it("a collapsed range stays as is", () => {
        const point = { line: 2, character: 3 };
        expect(rangeFrom({ start: point, end: point })).toStrictEqual({ start: point, end: point });
    });

    it("NaN and ±Infinity in any of the four coordinates — null", () => {
        for (const bad of [NaN, Infinity, -Infinity]) {
            expect(rangeFrom({ start: { line: bad, character: 0 }, end: { line: 0, character: 0 } })).toBeNull();
            expect(rangeFrom({ start: { line: 0, character: bad }, end: { line: 0, character: 0 } })).toBeNull();
            expect(rangeFrom({ start: { line: 0, character: 0 }, end: { line: bad, character: 0 } })).toBeNull();
            expect(rangeFrom({ start: { line: 0, character: 0 }, end: { line: 0, character: bad } })).toBeNull();
        }
    });

    it("a foreign shape is null: not an object, no start/end, flat wire, a coordinate as a string", () => {
        expect(rangeFrom(null)).toBeNull();
        expect(rangeFrom(undefined)).toBeNull();
        expect(rangeFrom(5)).toBeNull();
        expect(rangeFrom({ end: { line: 0, character: 0 } })).toBeNull();
        expect(rangeFrom({ start: { line: 0, character: 0 } })).toBeNull();
        expect(rangeFrom({ startLine: 0, startCharacter: 1, endLine: 0, endCharacter: 2 })).toBeNull();
        expect(rangeFrom({ start: { line: "0", character: 0 }, end: { line: 0, character: 0 } })).toBeNull();
    });
});

describe("stripSnippetPlaceholders", () => {
    it("strips placeholders, keeping their text", () => {
        expect(stripSnippetPlaceholders("greet(${1:name})$0")).toBe("greet(name)");
        expect(stripSnippetPlaceholders("if ${1|a,b|} then")).toBe("if a then");
        expect(stripSnippetPlaceholders("call(${1})")).toBe("call()");
        expect(stripSnippetPlaceholders("sum($1, $2)")).toBe("sum(, )");
    });

    it("an escaped dollar stays a dollar", () => {
        expect(stripSnippetPlaceholders("cost: \\$5")).toBe("cost: $5");
    });

    it("multi-digit tabstop indices are parsed whole", () => {
        expect(stripSnippetPlaceholders("f(${10:x})")).toBe("f(x)");
        expect(stripSnippetPlaceholders("f(${12})")).toBe("f()");
        expect(stripSnippetPlaceholders("f($12)")).toBe("f()");
        expect(stripSnippetPlaceholders("if ${10|a,b|} then")).toBe("if a then");
    });

    it("a choice of several options gives the whole first option", () => {
        expect(stripSnippetPlaceholders("${1|foo,bar|}")).toBe("foo");
    });

    it("an empty choice list does not break parsing", () => {
        expect(stripSnippetPlaceholders("x${1||}y")).toBe("xy");
    });
});

describe("decorations", () => {
    describe("serializeColor", () => {
        it("a CSS string passes as is", () => {
            expect(serializeColor("#ff0000")).toBe("#ff0000");
        });
        it("ThemeColor (duck type with id) → { $themeColor }", () => {
            expect(serializeColor({ id: "editorGutter.modifiedBackground" })).toEqual({
                $themeColor: "editorGutter.modifiedBackground",
            });
        });
        it("undefined / anything else → undefined", () => {
            expect(serializeColor(undefined)).toBeUndefined();
            expect(serializeColor(42)).toBeUndefined();
            expect(serializeColor({ nope: 1 })).toBeUndefined();
            expect(serializeColor(null)).toBeUndefined();
        });
    });

    describe("serializeDecorationRenderOptions", () => {
        it("carries only relevant fields, ThemeColor is serialized", () => {
            expect(
                serializeDecorationRenderOptions({
                    isWholeLine: true,
                    overviewRulerLane: 1,
                    overviewRulerColor: { id: "editorGutter.addedBackground" },
                    backgroundColor: "#111",
                    color: { id: "foreground" },
                    gutterIconPath: "/ignored.png",
                    borderWidth: "2px",
                }),
            ).toEqual({
                isWholeLine: true,
                overviewRulerLane: 1,
                overviewRulerColor: { $themeColor: "editorGutter.addedBackground" },
                backgroundColor: "#111",
                color: { $themeColor: "foreground" },
            });
        });
        it("empty/invalid options → an empty object", () => {
            expect(serializeDecorationRenderOptions(undefined)).toEqual({});
            expect(serializeDecorationRenderOptions(null)).toEqual({});
            expect(serializeDecorationRenderOptions({ isWholeLine: "yes" })).toEqual({});
        });
        it("missing and malformed fields have no key, not a key with undefined", () => {
            expect(serializeDecorationRenderOptions({})).toStrictEqual({});
            expect(
                serializeDecorationRenderOptions({
                    overviewRulerLane: "1",
                    backgroundColor: 1,
                    color: null,
                    overviewRulerColor: { nope: 1 },
                }),
            ).toStrictEqual({});
        });
    });
});

describe("toVscodeRange", () => {
    it("a wire range → an extension Range instance", () => {
        const range = toVscodeRange({ start: { line: 1, character: 2 }, end: { line: 3, character: 4 } });
        expect(range).toBeInstanceOf(Range);
        expect([range.start.line, range.start.character, range.end.line, range.end.character]).toEqual([1, 2, 3, 4]);
    });
});

describe("selections", () => {
    it("toWireSelection carries anchor/active as is — also for a reversed selection", () => {
        expect(toWireSelection(new Selection(3, 4, 1, 2))).toStrictEqual({
            anchorLine: 3,
            anchorCharacter: 4,
            activeLine: 1,
            activeCharacter: 2,
        });
    });

    it("toVscodeSelection converts back to a Selection with the same anchor/active", () => {
        const selection = toVscodeSelection({ anchorLine: 3, anchorCharacter: 4, activeLine: 1, activeCharacter: 2 });
        expect(selection).toBeInstanceOf(Selection);
        expect([selection.anchor.line, selection.anchor.character]).toEqual([3, 4]);
        expect([selection.active.line, selection.active.character]).toEqual([1, 2]);
    });
});

describe("toWireEditRange", () => {
    it("Range and Selection give their range; a reversed duck-typed one is flipped", () => {
        expect(toWireEditRange(new Range(0, 1, 0, 2))).toStrictEqual(RANGE);
        expect(toWireEditRange(new Selection(0, 2, 0, 1))).toStrictEqual(RANGE);
        expect(toWireEditRange(REVERSED as unknown as vscode.Range)).toStrictEqual(RANGE);
    });

    it("Position gives an empty range at the point; an object without end is a position too", () => {
        const point = { start: { line: 2, character: 3 }, end: { line: 2, character: 3 } };
        expect(toWireEditRange(new Position(2, 3))).toStrictEqual(point);
        const halfRange = { line: 2, character: 3, start: { line: 9, character: 9 } };
        expect(toWireEditRange(halfRange as unknown as vscode.Position)).toStrictEqual(point);
    });

    it("an object with end but without start is a position too, not a broken range", () => {
        const halfRange = { line: 2, character: 3, end: { line: 9, character: 9 } };
        expect(toWireEditRange(halfRange as unknown as vscode.Position)).toStrictEqual({
            start: { line: 2, character: 3 },
            end: { line: 2, character: 3 },
        });
    });

    it("a broken range is null", () => {
        expect(toWireEditRange(NAN_RANGE)).toBeNull();
        expect(toWireEditRange({ start: 1, end: 2 } as unknown as vscode.Range)).toBeNull();
    });
});

describe("normalizeDecorationRanges", () => {
    it("bare Range and DecorationOptions with .range; a reversed duck-typed one is flipped", () => {
        expect(normalizeDecorationRanges([new Range(0, 1, 0, 2), REVERSED as unknown as vscode.Range])).toStrictEqual([
            RANGE,
            RANGE,
        ]);
        expect(normalizeDecorationRanges([{ range: FOREIGN } as unknown as vscode.DecorationOptions])).toStrictEqual([
            RANGE,
        ]);
    });

    it("a broken range drops out, the rest stay", () => {
        const items = [
            NAN_RANGE,
            SHAPELESS,
            { range: undefined },
            new Range(0, 1, 0, 2),
        ] as unknown as readonly vscode.Range[];
        expect(normalizeDecorationRanges(items)).toStrictEqual([RANGE]);
    });
});

describe("toWireMarker", () => {
    it("a Diagnostic-like object → a wire marker", () => {
        expect(
            toWireMarker({ range: FOREIGN, message: "m", severity: 1, code: { value: 7 }, source: "ts" }),
        ).toStrictEqual({ severity: 1, range: RANGE, message: "m", code: "7", source: "ts" });
    });

    it("without range (undefined or null) — a marker at the start of the file", () => {
        const zero = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
        expect(toWireMarker({ message: "m" })?.range).toStrictEqual(zero);
        expect(toWireMarker({ range: null, message: "m" })?.range).toStrictEqual(zero);
    });

    it("a reversed duck-typed range is flipped", () => {
        expect(toWireMarker({ range: REVERSED })?.range).toStrictEqual(RANGE);
    });

    it("a broken range (no start/end, NaN) is null, not a TypeError", () => {
        expect(toWireMarker({ range: SHAPELESS, message: "m" })).toBeNull();
        expect(toWireMarker({ range: NAN_RANGE, message: "m" })).toBeNull();
        expect(toWireMarker({ range: "0:1", message: "m" })).toBeNull();
    });

    it("code: string and number as a string, rich form by its value, anything else without code", () => {
        expect(toWireMarker({ code: "E1" })?.code).toBe("E1");
        expect(toWireMarker({ code: 0 })?.code).toBe("0");
        expect(toWireMarker({ code: { value: "rule", target: "https://x" } })?.code).toBe("rule");
        expect(toWireMarker({ code: { target: "https://x" } })).not.toHaveProperty("code");
        expect(toWireMarker({ code: null })).not.toHaveProperty("code");
        expect(toWireMarker({ code: true })).not.toHaveProperty("code");
    });

    it("severity and source only of their own type", () => {
        expect(toWireMarker({ severity: "1", source: 5 })).toStrictEqual({
            severity: 0,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            message: "",
        });
    });

    it("message: string, rich form, null/undefined, other values", () => {
        expect(toWireMarker({ message: "" })?.message).toBe("");
        expect(toWireMarker({ message: { value: "**md**" } })?.message).toBe("**md**");
        expect(toWireMarker({ message: { value: 1 } })?.message).toBe("");
        expect(toWireMarker({ message: null })?.message).toBe("");
        expect(toWireMarker({ message: 42 })?.message).toBe("42");
    });
});

describe("serializeCompletionItem — replace range", () => {
    function rangeOf(range: unknown): unknown {
        const item = new CompletionItem("x");
        (item as { range?: unknown }).range = range;
        return serializeCompletionItem(item as unknown as vscode.CompletionItem, "1.0")?.range;
    }

    it("an extension Range and a foreign duck-typed Range (another bundle) both arrive", () => {
        expect(rangeOf(new Range(0, 1, 0, 2))).toStrictEqual(RANGE);
        expect(rangeOf(FOREIGN)).toStrictEqual(RANGE);
    });

    it("{ inserting, replacing } — replacing is taken, duck-typed too", () => {
        expect(rangeOf({ inserting: new Range(0, 1, 0, 1), replacing: new Range(0, 1, 0, 2) })).toStrictEqual(RANGE);
        expect(rangeOf({ inserting: FOREIGN, replacing: FOREIGN })).toStrictEqual(RANGE);
    });

    it("a reversed one is flipped", () => {
        expect(rangeOf(REVERSED)).toStrictEqual(RANGE);
    });

    it("no range or a broken one — no range field", () => {
        expect(rangeOf(undefined)).toBeUndefined();
        expect(rangeOf(null)).toBeUndefined();
        expect(rangeOf(5)).toBeUndefined();
        expect(rangeOf(NAN_RANGE)).toBeUndefined();
        expect(rangeOf({ inserting: FOREIGN })).toBeUndefined();
        expect(rangeOf({ replacing: SHAPELESS })).toBeUndefined();
    });
});

describe("serializeCompletionItem — field boundaries", () => {
    function serialize(fields: Record<string, unknown>): unknown {
        const item = new CompletionItem("x");
        Object.assign(item, fields);
        return serializeCompletionItem(item as unknown as vscode.CompletionItem, "1.0");
    }

    it("missing fields have no keys, not keys with undefined", () => {
        expect(serialize({})).toStrictEqual({ label: "x", insertText: "x", id: "1.0" });
        expect(serialize({ label: { label: "x" } })).toStrictEqual({ label: "x", insertText: "x", id: "1.0" });
    });

    it("fields of a foreign type have no keys", () => {
        expect(
            serialize({
                label: { label: "x", detail: 1, description: 2 },
                detail: 3,
                documentation: { value: 4 },
                sortText: 5,
                filterText: 6,
            }),
        ).toStrictEqual({ label: "x", insertText: "x", id: "1.0" });
    });

    it("label: null and a CompletionItemLabel with a non-string label — the item is dropped", () => {
        expect(serialize({ label: null })).toBeNull();
        expect(serialize({ label: { label: 5 } })).toBeNull();
    });

    it("a label that changes shape between reads (getter) gives no labelDetail, not a TypeError", () => {
        for (const second of [null, undefined]) {
            const item = new CompletionItem("x");
            const reads: unknown[] = [{ label: "x" }, second];
            Object.defineProperty(item, "label", { get: () => reads.shift() });
            expect(serializeCompletionItem(item as unknown as vscode.CompletionItem, "1.0")).toStrictEqual({
                label: "x",
                insertText: "x",
                id: "1.0",
            });
        }
    });

    it("insertText: null — label is inserted", () => {
        expect(serialize({ insertText: null })).toStrictEqual({ label: "x", insertText: "x", id: "1.0" });
    });

    it("readDocumentation: null and a MarkdownString with a non-string value — undefined", () => {
        const item = new CompletionItem("x");
        (item as { documentation?: unknown }).documentation = null;
        expect(readDocumentation(item as unknown as vscode.CompletionItem)).toBeUndefined();
        (item as { documentation?: unknown }).documentation = { value: 1 };
        expect(readDocumentation(item as unknown as vscode.CompletionItem)).toBeUndefined();
    });
});

describe("serializeFoldingRange", () => {
    it("a non-finite bound (NaN, Infinity) is null", () => {
        for (const bad of [NaN, Infinity]) {
            expect(serializeFoldingRange({ start: bad, end: 1 } as vscode.FoldingRange)).toBeNull();
            expect(serializeFoldingRange({ start: 0, end: bad } as vscode.FoldingRange)).toBeNull();
        }
    });
});

describe("text edits", () => {
    it("serializeTextEdit: a duck-typed edit → a wire edit; the range is flipped", () => {
        expect(serializeTextEdit({ range: REVERSED, newText: "x" })).toStrictEqual({ range: RANGE, text: "x" });
        expect(serializeTextEdit(new TextEdit(new Range(0, 1, 0, 2), ""))).toStrictEqual({ range: RANGE, text: "" });
    });

    it("serializeTextEdit: a foreign shape is null", () => {
        expect(serializeTextEdit(null)).toBeNull();
        expect(serializeTextEdit("edit")).toBeNull();
        // A function with edit fields is not an edit object, even though its fields are readable.
        expect(serializeTextEdit(Object.assign(() => undefined, { range: FOREIGN, newText: "x" }))).toBeNull();
        expect(serializeTextEdit({ range: SHAPELESS, newText: "x" })).toBeNull();
        expect(serializeTextEdit({ range: FOREIGN, newText: 1 })).toBeNull();
    });

    it("serializeWillSaveTextEdit: an EOL change gives a wire code, otherwise a text edit", () => {
        expect(serializeWillSaveTextEdit(TextEdit.setEndOfLine(EndOfLine.CRLF))).toStrictEqual({ setEndOfLine: 2 });
        expect(serializeWillSaveTextEdit(TextEdit.setEndOfLine(EndOfLine.LF))).toStrictEqual({ setEndOfLine: 1 });
        expect(serializeWillSaveTextEdit(new TextEdit(new Range(0, 1, 0, 2), "y"))).toStrictEqual({
            range: RANGE,
            text: "y",
        });
        expect(serializeWillSaveTextEdit(new TextEdit(NAN_RANGE, "y"))).toBeNull();
    });
});

describe("serializeWorkspaceEdit — broken ranges", () => {
    /** TextEdit's `range` field is public and writable. */
    function brokenEdit(range: unknown): TextEdit {
        const edit = new TextEdit(new Range(0, 0, 0, 0), "bad");
        (edit as { range: unknown }).range = range;
        return edit;
    }

    it("a broken edit drops out, intact neighbors go through; a reversed range is flipped", () => {
        const edit = new WorkspaceEdit();
        edit.set(URI_A, [brokenEdit(SHAPELESS), brokenEdit(REVERSED), brokenEdit(NAN_RANGE)]);
        expect(serializeWorkspaceEdit(edit)).toStrictEqual([
            { kind: "text", resource: URI_A.toString(), edits: [{ range: RANGE, text: "bad" }] },
        ]);
    });

    it("an operation of only broken edits rejects the whole edit (null)", () => {
        const edit = new WorkspaceEdit();
        edit.createFile(URI_A);
        edit.set(URI_A, [brokenEdit(SHAPELESS), brokenEdit(NAN_RANGE)]);
        expect(serializeWorkspaceEdit(edit)).toBeNull();
    });

    it("an operation of only an EOL edit carries the line ending, it is not a rejection", () => {
        const edit = new WorkspaceEdit();
        edit.set(URI_A, [TextEdit.setEndOfLine(EndOfLine.CRLF)]);
        expect(serializeWorkspaceEdit(edit)).toStrictEqual([
            { kind: "text", resource: URI_A.toString(), edits: [], setEndOfLine: 2 },
        ]);
    });

    it("a snippet edit with a reversed duck-typed range becomes text with the flipped range", () => {
        const snippet = new SnippetTextEdit(new Range(0, 0, 0, 0), new SnippetString("f(${1:a})"));
        (snippet as { range: unknown }).range = REVERSED;
        const edit = new WorkspaceEdit();
        edit.set(URI_A, [snippet]);
        expect(serializeWorkspaceEdit(edit)).toStrictEqual([
            { kind: "text", resource: URI_A.toString(), edits: [{ range: RANGE, text: "f(a)" }] },
        ]);
    });
});

describe("toVscodeSignatureHelp", () => {
    it("a plain core signature help → SignatureHelp/SignatureInformation/ParameterInformation instances", () => {
        const offsets: readonly [number, number] = [6, 10];
        const help = toVscodeSignatureHelp({
            signatures: [
                {
                    label: "greet(name)",
                    documentation: "doc",
                    parameters: [{ label: "name", documentation: "whom" }, { label: offsets }],
                    activeParameter: 1,
                },
                { label: "greet()", parameters: [] },
            ],
            activeSignature: 1,
            activeParameter: 2,
        });

        expect(help).toBeInstanceOf(SignatureHelp);
        expect(help.activeSignature).toBe(1);
        expect(help.activeParameter).toBe(2);
        const [first, second] = help.signatures;
        expect(first).toBeInstanceOf(SignatureInformation);
        expect(first.label).toBe("greet(name)");
        expect(first.documentation).toBe("doc");
        expect(first.activeParameter).toBe(1);
        expect(first.parameters[0]).toBeInstanceOf(ParameterInformation);
        expect(first.parameters[0]).toMatchObject({ label: "name", documentation: "whom" });
        // An own mutable copy: the core's readonly tuple is not handed to the provider.
        expect(first.parameters[1].label).toEqual([6, 10]);
        expect(first.parameters[1].label).not.toBe(offsets);
        expect(first.parameters[1].documentation).toBeUndefined();
        expect(second.parameters).toEqual([]);
        expect(second.activeParameter).toBeUndefined();
    });
});
