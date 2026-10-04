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

// Конвертеры «объект расширения ↔ провод» субпроцесса. Объект расширения
// утиный: поля публичны и записываемы, а `Range` может прийти из чужого бандла.
// Битый диапазон (чужая форма, не конечная координата) везде собирает один
// `rangeFrom` — и везде он выпадает, а не роняет вызов расширения.

/** Диапазон на проводе — core `IRange`. */
const RANGE = { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } };
/** Тот же диапазон чужим утиным объектом (другой бандл `vscode`-типов). */
const FOREIGN = { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } };
/** Перевёрнутый утиный диапазон (`end` раньше `start`). */
const REVERSED = { start: { line: 0, character: 2 }, end: { line: 0, character: 1 } };
/** Диапазон без границ — `start`/`end` нет вовсе. */
const SHAPELESS = { line: 0 };
/** Диапазон расширения с не конечной координатой (`Position` клампит к нулю, но `NaN` пропускает). */
const NAN_RANGE = new Range(NaN, 1, 0, 2);
const URI_A = Uri.file("/proj/a.ts");

describe("rangeFrom", () => {
    it("Range расширения — в core IRange из чистых объектов, без прототипа Position", () => {
        const range = rangeFrom(new Range(1, 2, 3, 4));
        expect(range).toStrictEqual({ start: { line: 1, character: 2 }, end: { line: 3, character: 4 } });
    });

    it("чужой утиный Range (другой бандл, лишние поля) принимается по форме", () => {
        const foreign = {
            start: { line: 0, character: 1, extra: true },
            end: { line: 0, character: 2 },
            isEmpty: false,
        };
        expect(rangeFrom(foreign)).toStrictEqual(RANGE);
    });

    it("перевёрнутый диапазон разворачивается: по строке и по символу в одной строке", () => {
        expect(rangeFrom({ start: { line: 3, character: 0 }, end: { line: 1, character: 5 } })).toStrictEqual({
            start: { line: 1, character: 5 },
            end: { line: 3, character: 0 },
        });
        expect(rangeFrom({ start: { line: 0, character: 2 }, end: { line: 0, character: 1 } })).toStrictEqual(RANGE);
    });

    it("схлопнутый диапазон остаётся как есть", () => {
        const point = { line: 2, character: 3 };
        expect(rangeFrom({ start: point, end: point })).toStrictEqual({ start: point, end: point });
    });

    it("NaN и ±Infinity в любой из четырёх координат — null", () => {
        for (const bad of [NaN, Infinity, -Infinity]) {
            expect(rangeFrom({ start: { line: bad, character: 0 }, end: { line: 0, character: 0 } })).toBeNull();
            expect(rangeFrom({ start: { line: 0, character: bad }, end: { line: 0, character: 0 } })).toBeNull();
            expect(rangeFrom({ start: { line: 0, character: 0 }, end: { line: bad, character: 0 } })).toBeNull();
            expect(rangeFrom({ start: { line: 0, character: 0 }, end: { line: 0, character: bad } })).toBeNull();
        }
    });

    it("чужая форма — null: не объект, нет start/end, плоский провод, координата строкой", () => {
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
    it("вырезает плейсхолдеры, оставляя их текст", () => {
        expect(stripSnippetPlaceholders("greet(${1:name})$0")).toBe("greet(name)");
        expect(stripSnippetPlaceholders("if ${1|a,b|} then")).toBe("if a then");
        expect(stripSnippetPlaceholders("call(${1})")).toBe("call()");
        expect(stripSnippetPlaceholders("sum($1, $2)")).toBe("sum(, )");
    });

    it("экранированный доллар остаётся долларом", () => {
        expect(stripSnippetPlaceholders("cost: \\$5")).toBe("cost: $5");
    });

    it("многозначные индексы табстопов разбираются целиком", () => {
        expect(stripSnippetPlaceholders("f(${10:x})")).toBe("f(x)");
        expect(stripSnippetPlaceholders("f(${12})")).toBe("f()");
        expect(stripSnippetPlaceholders("f($12)")).toBe("f()");
        expect(stripSnippetPlaceholders("if ${10|a,b|} then")).toBe("if a then");
    });

    it("выбор из нескольких вариантов — первый вариант целиком", () => {
        expect(stripSnippetPlaceholders("${1|foo,bar|}")).toBe("foo");
    });

    it("пустой список вариантов не ломает разбор", () => {
        expect(stripSnippetPlaceholders("x${1||}y")).toBe("xy");
    });
});

describe("декорации", () => {
    describe("serializeColor", () => {
        it("CSS-строка проходит как есть", () => {
            expect(serializeColor("#ff0000")).toBe("#ff0000");
        });
        it("ThemeColor (утиный тип с id) → { $themeColor }", () => {
            expect(serializeColor({ id: "editorGutter.modifiedBackground" })).toEqual({
                $themeColor: "editorGutter.modifiedBackground",
            });
        });
        it("undefined / прочее → undefined", () => {
            expect(serializeColor(undefined)).toBeUndefined();
            expect(serializeColor(42)).toBeUndefined();
            expect(serializeColor({ nope: 1 })).toBeUndefined();
            expect(serializeColor(null)).toBeUndefined();
        });
    });

    describe("serializeDecorationRenderOptions", () => {
        it("несёт только релевантные поля, ThemeColor сериализуется", () => {
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
        it("пустые/невалидные опции → пустой объект", () => {
            expect(serializeDecorationRenderOptions(undefined)).toEqual({});
            expect(serializeDecorationRenderOptions(null)).toEqual({});
            expect(serializeDecorationRenderOptions({ isWholeLine: "yes" })).toEqual({});
        });
        it("отсутствующие и кривые поля — без ключа, а не ключом с undefined", () => {
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
    it("диапазон провода → экземпляр Range расширения", () => {
        const range = toVscodeRange({ start: { line: 1, character: 2 }, end: { line: 3, character: 4 } });
        expect(range).toBeInstanceOf(Range);
        expect([range.start.line, range.start.character, range.end.line, range.end.character]).toEqual([1, 2, 3, 4]);
    });
});

describe("выделения", () => {
    it("toWireSelection несёт anchor/active как есть — и у перевёрнутого выделения", () => {
        expect(toWireSelection(new Selection(3, 4, 1, 2))).toStrictEqual({
            anchorLine: 3,
            anchorCharacter: 4,
            activeLine: 1,
            activeCharacter: 2,
        });
    });

    it("toVscodeSelection — обратный перевод в Selection с тем же anchor/active", () => {
        const selection = toVscodeSelection({ anchorLine: 3, anchorCharacter: 4, activeLine: 1, activeCharacter: 2 });
        expect(selection).toBeInstanceOf(Selection);
        expect([selection.anchor.line, selection.anchor.character]).toEqual([3, 4]);
        expect([selection.active.line, selection.active.character]).toEqual([1, 2]);
    });
});

describe("toWireEditRange", () => {
    it("Range и Selection — их диапазон; перевёрнутый утиный разворачивается", () => {
        expect(toWireEditRange(new Range(0, 1, 0, 2))).toStrictEqual(RANGE);
        expect(toWireEditRange(new Selection(0, 2, 0, 1))).toStrictEqual(RANGE);
        expect(toWireEditRange(REVERSED as unknown as vscode.Range)).toStrictEqual(RANGE);
    });

    it("Position — пустой диапазон в точке; объект без end — тоже позиция", () => {
        const point = { start: { line: 2, character: 3 }, end: { line: 2, character: 3 } };
        expect(toWireEditRange(new Position(2, 3))).toStrictEqual(point);
        const halfRange = { line: 2, character: 3, start: { line: 9, character: 9 } };
        expect(toWireEditRange(halfRange as unknown as vscode.Position)).toStrictEqual(point);
    });

    it("объект с end, но без start — тоже позиция, а не битый диапазон", () => {
        const halfRange = { line: 2, character: 3, end: { line: 9, character: 9 } };
        expect(toWireEditRange(halfRange as unknown as vscode.Position)).toStrictEqual({
            start: { line: 2, character: 3 },
            end: { line: 2, character: 3 },
        });
    });

    it("битый диапазон — null", () => {
        expect(toWireEditRange(NAN_RANGE)).toBeNull();
        expect(toWireEditRange({ start: 1, end: 2 } as unknown as vscode.Range)).toBeNull();
    });
});

describe("normalizeDecorationRanges", () => {
    it("голые Range и DecorationOptions с .range; перевёрнутый утиный разворачивается", () => {
        expect(normalizeDecorationRanges([new Range(0, 1, 0, 2), REVERSED as unknown as vscode.Range])).toStrictEqual([
            RANGE,
            RANGE,
        ]);
        expect(normalizeDecorationRanges([{ range: FOREIGN } as unknown as vscode.DecorationOptions])).toStrictEqual([
            RANGE,
        ]);
    });

    it("битый диапазон выпадает, остальные остаются", () => {
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
    it("Diagnostic-подобный объект → маркер провода", () => {
        expect(
            toWireMarker({ range: FOREIGN, message: "m", severity: 1, code: { value: 7 }, source: "ts" }),
        ).toStrictEqual({ severity: 1, range: RANGE, message: "m", code: "7", source: "ts" });
    });

    it("без range (undefined или null) — маркер в начале файла", () => {
        const zero = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
        expect(toWireMarker({ message: "m" })?.range).toStrictEqual(zero);
        expect(toWireMarker({ range: null, message: "m" })?.range).toStrictEqual(zero);
    });

    it("перевёрнутый утиный диапазон разворачивается", () => {
        expect(toWireMarker({ range: REVERSED })?.range).toStrictEqual(RANGE);
    });

    it("битый диапазон (нет start/end, NaN) — null, а не TypeError", () => {
        expect(toWireMarker({ range: SHAPELESS, message: "m" })).toBeNull();
        expect(toWireMarker({ range: NAN_RANGE, message: "m" })).toBeNull();
        expect(toWireMarker({ range: "0:1", message: "m" })).toBeNull();
    });

    it("code: строка и число — строкой, rich-форма — своим value, прочее — без code", () => {
        expect(toWireMarker({ code: "E1" })?.code).toBe("E1");
        expect(toWireMarker({ code: 0 })?.code).toBe("0");
        expect(toWireMarker({ code: { value: "rule", target: "https://x" } })?.code).toBe("rule");
        expect(toWireMarker({ code: { target: "https://x" } })).not.toHaveProperty("code");
        expect(toWireMarker({ code: null })).not.toHaveProperty("code");
        expect(toWireMarker({ code: true })).not.toHaveProperty("code");
    });

    it("severity и source — только своего типа", () => {
        expect(toWireMarker({ severity: "1", source: 5 })).toStrictEqual({
            severity: 0,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            message: "",
        });
    });

    it("message: строка, rich-форма, null/undefined, прочие значения", () => {
        expect(toWireMarker({ message: "" })?.message).toBe("");
        expect(toWireMarker({ message: { value: "**md**" } })?.message).toBe("**md**");
        expect(toWireMarker({ message: { value: 1 } })?.message).toBe("");
        expect(toWireMarker({ message: null })?.message).toBe("");
        expect(toWireMarker({ message: 42 })?.message).toBe("42");
    });
});

describe("serializeCompletionItem — диапазон замены", () => {
    function rangeOf(range: unknown): unknown {
        const item = new CompletionItem("x");
        (item as { range?: unknown }).range = range;
        return serializeCompletionItem(item as unknown as vscode.CompletionItem, "1.0")?.range;
    }

    it("Range расширения и чужой утиный Range (другой бандл) — оба доезжают", () => {
        expect(rangeOf(new Range(0, 1, 0, 2))).toStrictEqual(RANGE);
        expect(rangeOf(FOREIGN)).toStrictEqual(RANGE);
    });

    it("{ inserting, replacing } — берётся replacing, утиный тоже", () => {
        expect(rangeOf({ inserting: new Range(0, 1, 0, 1), replacing: new Range(0, 1, 0, 2) })).toStrictEqual(RANGE);
        expect(rangeOf({ inserting: FOREIGN, replacing: FOREIGN })).toStrictEqual(RANGE);
    });

    it("перевёрнутый разворачивается", () => {
        expect(rangeOf(REVERSED)).toStrictEqual(RANGE);
    });

    it("нет диапазона или он битый — поля range нет", () => {
        expect(rangeOf(undefined)).toBeUndefined();
        expect(rangeOf(null)).toBeUndefined();
        expect(rangeOf(5)).toBeUndefined();
        expect(rangeOf(NAN_RANGE)).toBeUndefined();
        expect(rangeOf({ inserting: FOREIGN })).toBeUndefined();
        expect(rangeOf({ replacing: SHAPELESS })).toBeUndefined();
    });
});

describe("serializeCompletionItem — границы полей", () => {
    function serialize(fields: Record<string, unknown>): unknown {
        const item = new CompletionItem("x");
        Object.assign(item, fields);
        return serializeCompletionItem(item as unknown as vscode.CompletionItem, "1.0");
    }

    it("отсутствующие поля — без ключей, а не ключами с undefined", () => {
        expect(serialize({})).toStrictEqual({ label: "x", insertText: "x", id: "1.0" });
        expect(serialize({ label: { label: "x" } })).toStrictEqual({ label: "x", insertText: "x", id: "1.0" });
    });

    it("поля чужого типа — без ключей", () => {
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

    it("label: null и CompletionItemLabel с нестроковым label — пункт отбрасывается", () => {
        expect(serialize({ label: null })).toBeNull();
        expect(serialize({ label: { label: 5 } })).toBeNull();
    });

    it("label, сменивший форму между чтениями (геттер), — без labelDetail, а не TypeError", () => {
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

    it("insertText: null — вставляется label", () => {
        expect(serialize({ insertText: null })).toStrictEqual({ label: "x", insertText: "x", id: "1.0" });
    });

    it("readDocumentation: null и MarkdownString с нестроковым value — undefined", () => {
        const item = new CompletionItem("x");
        (item as { documentation?: unknown }).documentation = null;
        expect(readDocumentation(item as unknown as vscode.CompletionItem)).toBeUndefined();
        (item as { documentation?: unknown }).documentation = { value: 1 };
        expect(readDocumentation(item as unknown as vscode.CompletionItem)).toBeUndefined();
    });
});

describe("serializeFoldingRange", () => {
    it("не конечная граница (NaN, Infinity) — null", () => {
        for (const bad of [NaN, Infinity]) {
            expect(serializeFoldingRange({ start: bad, end: 1 } as vscode.FoldingRange)).toBeNull();
            expect(serializeFoldingRange({ start: 0, end: bad } as vscode.FoldingRange)).toBeNull();
        }
    });
});

describe("правки текста", () => {
    it("serializeTextEdit: утиная правка → правка провода; диапазон разворачивается", () => {
        expect(serializeTextEdit({ range: REVERSED, newText: "x" })).toStrictEqual({ range: RANGE, text: "x" });
        expect(serializeTextEdit(new TextEdit(new Range(0, 1, 0, 2), ""))).toStrictEqual({ range: RANGE, text: "" });
    });

    it("serializeTextEdit: чужая форма — null", () => {
        expect(serializeTextEdit(null)).toBeNull();
        expect(serializeTextEdit("edit")).toBeNull();
        // Функция с полями правки — не объект правки, хоть поля у неё и читаются.
        expect(serializeTextEdit(Object.assign(() => undefined, { range: FOREIGN, newText: "x" }))).toBeNull();
        expect(serializeTextEdit({ range: SHAPELESS, newText: "x" })).toBeNull();
        expect(serializeTextEdit({ range: FOREIGN, newText: 1 })).toBeNull();
    });

    it("serializeWillSaveTextEdit: смена EOL — код провода, иначе — правка текста", () => {
        expect(serializeWillSaveTextEdit(TextEdit.setEndOfLine(EndOfLine.CRLF))).toStrictEqual({ setEndOfLine: 2 });
        expect(serializeWillSaveTextEdit(TextEdit.setEndOfLine(EndOfLine.LF))).toStrictEqual({ setEndOfLine: 1 });
        expect(serializeWillSaveTextEdit(new TextEdit(new Range(0, 1, 0, 2), "y"))).toStrictEqual({
            range: RANGE,
            text: "y",
        });
        expect(serializeWillSaveTextEdit(new TextEdit(NAN_RANGE, "y"))).toBeNull();
    });
});

describe("serializeWorkspaceEdit — битые диапазоны", () => {
    /** Правка с подменённым диапазоном: поле `range` у TextEdit публично и записываемо. */
    function brokenEdit(range: unknown): TextEdit {
        const edit = new TextEdit(new Range(0, 0, 0, 0), "bad");
        (edit as { range: unknown }).range = range;
        return edit;
    }

    it("битая правка выпадает, целые соседи едут; перевёрнутый диапазон разворачивается", () => {
        const edit = new WorkspaceEdit();
        edit.set(URI_A, [brokenEdit(SHAPELESS), brokenEdit(REVERSED), brokenEdit(NAN_RANGE)]);
        expect(serializeWorkspaceEdit(edit)).toStrictEqual([
            { kind: "text", resource: URI_A.toString(), edits: [{ range: RANGE, text: "bad" }] },
        ]);
    });

    it("операция из одних битых правок — отказ всего edit'а (null)", () => {
        const edit = new WorkspaceEdit();
        edit.createFile(URI_A);
        edit.set(URI_A, [brokenEdit(SHAPELESS), brokenEdit(NAN_RANGE)]);
        expect(serializeWorkspaceEdit(edit)).toBeNull();
    });

    it("операция из одного EOL-шума — просто выпадает, это не отказ", () => {
        const edit = new WorkspaceEdit();
        edit.set(URI_A, [TextEdit.setEndOfLine(EndOfLine.LF)]);
        expect(serializeWorkspaceEdit(edit)).toStrictEqual([]);
    });

    it("сниппет-правка с утиным перевёрнутым диапазоном — текстом с развёрнутым диапазоном", () => {
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
    it("plain-подсказка ядра → экземпляры SignatureHelp/SignatureInformation/ParameterInformation", () => {
        const offsets: readonly [number, number] = [6, 10];
        const help = toVscodeSignatureHelp({
            signatures: [
                {
                    label: "greet(name)",
                    documentation: "doc",
                    parameters: [{ label: "name", documentation: "кого" }, { label: offsets }],
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
        expect(first.parameters[0]).toMatchObject({ label: "name", documentation: "кого" });
        // Пара офсетов — своя изменяемая копия: readonly-кортеж ядра провайдеру не отдаём.
        expect(first.parameters[1].label).toEqual([6, 10]);
        expect(first.parameters[1].label).not.toBe(offsets);
        expect(first.parameters[1].documentation).toBeUndefined();
        expect(second.parameters).toEqual([]);
        expect(second.activeParameter).toBeUndefined();
    });
});
