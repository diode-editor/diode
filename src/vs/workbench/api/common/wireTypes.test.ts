import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { EndOfLine } from "../../../editor/common/core/endOfLine.ts";

import { createInProcessChannelPair } from "./inProcessChannelPair.ts";
import { RpcEndpoint } from "./rpcEndpoint.ts";
import type { WireCompletionItem, WireTextEdit } from "./wireTypes.ts";
import {
    parseWireCloseGroupsParams,
    parseWireCloseTabsParams,
    parseWireCompletionItems,
    parseWireEditorEdits,
    parseWireCompletionResult,
    parseWireEditorLayout,
    parseWireFoldingRanges,
    parseWireReadFileResult,
    parseWireResolvedCompletionItem,
    parseWireSelections,
    parseWireShowTextDocumentParams,
    parseWireTextEdits,
    reviveWireUri,
    requestCompletionItems,
    requestFoldingRanges,
    requestResolveCompletionItem,
    requestWillSaveEdits,
    wireToCoreCompletionItems,
    wireToCoreFoldingRegions,
    wireToSaveEdits,
} from "./wireTypes.ts";

const PARAMS = {
    uri: Uri.file("/tmp/file.txt").toString(),
    languageId: "plaintext",
    version: 1,
    isDirty: true,
    text: "hi\n",
    reason: 1,
    eol: 1,
};

describe("WireTypes — parseWireTextEdits", () => {
    it("парсит текстовую правку и setEndOfLine", () => {
        const raw = [
            { range: { startLine: 0, startCharacter: 1, endLine: 0, endCharacter: 3 }, text: "x" },
            { setEndOfLine: 2 },
        ];
        expect(parseWireTextEdits(raw)).toEqual(raw);
    });

    it("отбрасывает невалидные элементы (drop+skip), не роняя весь ответ", () => {
        const raw = [
            null,
            42,
            { text: "x" }, // range отсутствует
            { range: null, text: "x" }, // range === null
            { range: { startLine: 0 }, text: "x" }, // неполный range
            { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }, text: 5 }, // text не строка
            { setEndOfLine: 3 }, // недопустимый eol
            { setEndOfLine: 1 }, // валидный
        ];
        expect(parseWireTextEdits(raw)).toEqual([{ setEndOfLine: 1 }]);
    });

    it("не-массив → пустой результат", () => {
        expect(parseWireTextEdits(undefined)).toEqual([]);
        expect(parseWireTextEdits({})).toEqual([]);
    });
});

describe("WireTypes — wireToSaveEdits", () => {
    it("текстовая правка → core ISaveEdit с 0-based диапазоном", () => {
        const wire: WireTextEdit[] = [
            { range: { startLine: 2, startCharacter: 4, endLine: 2, endCharacter: 9 }, text: "abc" },
        ];
        expect(wireToSaveEdits(wire)).toEqual([
            {
                kind: "text",
                range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
                text: "abc",
            },
        ]);
    });

    it("setEndOfLine 2 → CRLF, 1 → LF", () => {
        expect(wireToSaveEdits([{ setEndOfLine: 2 }])).toEqual([{ kind: "eol", eol: EndOfLine.CRLF }]);
        expect(wireToSaveEdits([{ setEndOfLine: 1 }])).toEqual([{ kind: "eol", eol: EndOfLine.LF }]);
    });
});

describe("WireTypes — requestWillSaveEdits (InProcessChannelPair)", () => {
    function connectPair(): { host: RpcEndpoint; sub: RpcEndpoint; dispose: () => void } {
        const [a, b] = createInProcessChannelPair();
        const host = new RpcEndpoint(a);
        const sub = new RpcEndpoint(b);
        return {
            host,
            sub,
            dispose: () => {
                host.dispose();
                sub.dispose();
            },
        };
    }

    it("десериализует правки, вернувшиеся от subprocess'а", async () => {
        const { host, sub, dispose } = connectPair();
        try {
            sub.handleRequest("workspace.willSaveTextDocument", () => [
                { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 2 }, text: "" },
                { setEndOfLine: 2 },
            ]);
            const edits = await requestWillSaveEdits((m, p) => host.request(m, p), PARAMS, 1000);
            expect(edits).toEqual([
                { kind: "text", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: "" },
                { kind: "eol", eol: EndOfLine.CRLF },
            ]);
        } finally {
            dispose();
        }
    });

    it("возвращает пустой результат по таймауту, если participant никогда не резолвится", async () => {
        const { host, sub, dispose } = connectPair();
        try {
            sub.handleRequest("workspace.willSaveTextDocument", () => new Promise(() => {}));
            const edits = await requestWillSaveEdits((m, p) => host.request(m, p), PARAMS, 30);
            expect(edits).toEqual([]);
        } finally {
            dispose();
        }
    });

    it("возвращает пустой результат при ошибке RPC-хендлера", async () => {
        const { host, sub, dispose } = connectPair();
        try {
            sub.handleRequest("workspace.willSaveTextDocument", () => {
                throw new Error("boom");
            });
            const edits = await requestWillSaveEdits((m, p) => host.request(m, p), PARAMS, 1000);
            expect(edits).toEqual([]);
        } finally {
            dispose();
        }
    });
});

// ─── Completion ───────────────────────────────────────────────────────────────

const COMPLETION_PARAMS = {
    uri: Uri.file("/proj/.editorconfig").toString(),
    languageId: "editorconfig",
    text: "ind",
    line: 0,
    character: 3,
};

describe("WireTypes — parseWireCompletionItems", () => {
    it("парсит полный элемент и подставляет insertText из label", () => {
        const raw = [
            {
                label: "indent_style",
                kind: 9,
                detail: "EditorConfig",
                command: { command: "c._trigger", arguments: [1] },
                range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 3 },
            },
            { label: "root", insertText: "root = true" },
        ];
        const parsed = parseWireCompletionItems(raw);
        expect(parsed[0].insertText).toBe("indent_style"); // fallback на label
        expect(parsed[0].command).toEqual({ command: "c._trigger", arguments: [1] });
        expect(parsed[1].insertText).toBe("root = true");
    });

    it("отбрасывает невалидные элементы (нет label / битый range)", () => {
        const raw = [
            null,
            { insertText: "x" }, // нет label
            { label: "" }, // пустой label
            { label: "ok", range: { startLine: 0 } }, // битый range → range опущен, элемент валиден
        ];
        const parsed = parseWireCompletionItems(raw);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].label).toBe("ok");
        expect(parsed[0].range).toBeUndefined();
    });

    it("подхватывает documentation/sortText/filterText, пустую command отбрасывает", () => {
        const parsed = parseWireCompletionItems([
            {
                label: "x",
                documentation: "doc",
                sortText: "0",
                filterText: "xf",
                command: { command: "" }, // пустая команда → отбрасывается
            },
        ]);
        expect(parsed[0]).toEqual({
            label: "x",
            insertText: "x",
            documentation: "doc",
            sortText: "0",
            filterText: "xf",
        });
        expect(parsed[0].command).toBeUndefined();
    });

    it("не-массив → []", () => {
        expect(parseWireCompletionItems(undefined)).toEqual([]);
    });

    it("labelDetails доезжают до core-элемента", () => {
        const [core] = wireToCoreCompletionItems([
            { label: "getTime", insertText: ".getTime", id: "1.0", labelDetail: "(): number", labelDescription: "lib" },
        ]);
        expect(core).toMatchObject({ id: "1.0", labelDetail: "(): number", labelDescription: "lib" });
    });

    it("id/labelDetails: пустой id и нестроковые поля отбрасываются", () => {
        const parsed = parseWireCompletionItems([
            { label: "a", id: "", labelDetail: 5, labelDescription: null },
            { label: "b", id: "1.0", labelDetail: "(): void", labelDescription: "lib.d.ts" },
        ]);
        expect(parsed[0].id).toBeUndefined();
        expect(parsed[0].labelDetail).toBeUndefined();
        expect(parsed[0].labelDescription).toBeUndefined();
        expect(parsed[1]).toMatchObject({ id: "1.0", labelDetail: "(): void", labelDescription: "lib.d.ts" });
    });
});

describe("WireTypes — wireToCoreCompletionItems", () => {
    it("маппит range в core IRange и сохраняет command", () => {
        const wire: WireCompletionItem[] = [
            {
                label: "root",
                insertText: "root",
                kind: 9,
                range: { startLine: 1, startCharacter: 2, endLine: 1, endCharacter: 6 },
                command: { command: "c", arguments: [true] },
            },
        ];
        expect(wireToCoreCompletionItems(wire)).toEqual([
            {
                label: "root",
                insertText: "root",
                kind: 9,
                range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } },
                command: { command: "c", arguments: [true] },
            },
        ]);
    });

    it("маппит documentation/sortText/filterText и элемент без kind/команды", () => {
        const wire: WireCompletionItem[] = [
            {
                label: "word",
                insertText: "word",
                documentation: "d",
                sortText: "s",
                filterText: "f",
                command: { command: "c" }, // без arguments
            },
        ];
        expect(wireToCoreCompletionItems(wire)).toEqual([
            {
                label: "word",
                insertText: "word",
                documentation: "d",
                sortText: "s",
                filterText: "f",
                command: { command: "c" },
            },
        ]);
    });
});

describe("WireTypes — requestCompletionItems (InProcessChannelPair)", () => {
    function connectPair(): { host: RpcEndpoint; sub: RpcEndpoint; dispose: () => void } {
        const [a, b] = createInProcessChannelPair();
        const host = new RpcEndpoint(a);
        const sub = new RpcEndpoint(b);
        return {
            host,
            sub,
            dispose: () => {
                host.dispose();
                sub.dispose();
            },
        };
    }

    it("десериализует элементы, вернувшиеся от subprocess'а", async () => {
        const { host, sub, dispose } = connectPair();
        try {
            sub.handleRequest("languages.provideCompletionItems", () => [
                { label: "indent_style", insertText: "indent_style", kind: 9 },
            ]);
            // Голый массив — форма ответа до появления isIncomplete; читаем её
            // как полный список (расширение из чужой поставки не обязано знать
            // про новую форму).
            const result = await requestCompletionItems((m, p) => host.request(m, p), COMPLETION_PARAMS, 1000);
            expect(result).toEqual({
                items: [{ label: "indent_style", insertText: "indent_style", kind: 9 }],
                isIncomplete: false,
            });
        } finally {
            dispose();
        }
    });

    it("возвращает пустой результат по таймауту", async () => {
        const { host, sub, dispose } = connectPair();
        try {
            sub.handleRequest("languages.provideCompletionItems", () => new Promise(() => {}));
            const result = await requestCompletionItems((m, p) => host.request(m, p), COMPLETION_PARAMS, 30);
            expect(result).toEqual({ items: [], isIncomplete: false });
        } finally {
            dispose();
        }
    });

    it("возвращает пустой результат при ошибке RPC-хендлера", async () => {
        const { host, sub, dispose } = connectPair();
        try {
            sub.handleRequest("languages.provideCompletionItems", () => {
                throw new Error("boom");
            });
            const result = await requestCompletionItems((m, p) => host.request(m, p), COMPLETION_PARAMS, 1000);
            expect(result).toEqual({ items: [], isIncomplete: false });
        } finally {
            dispose();
        }
    });
});

describe("WireTypes — resolveCompletionItem", () => {
    function connectPair(): { host: RpcEndpoint; sub: RpcEndpoint; dispose: () => void } {
        const [a, b] = createInProcessChannelPair();
        const host = new RpcEndpoint(a);
        const sub = new RpcEndpoint(b);
        return {
            host,
            sub,
            dispose: () => {
                host.dispose();
                sub.dispose();
            },
        };
    }

    it("парсит detail/documentation и правки-спутники", () => {
        const parsed = parseWireResolvedCompletionItem({
            detail: "(alias) greet",
            documentation: "Greets someone.",
            additionalEdits: [
                { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }, text: "import x\n" },
            ],
        });
        expect(parsed?.detail).toBe("(alias) greet");
        expect(parsed?.documentation).toBe("Greets someone.");
        expect(parsed?.additionalEdits).toEqual([
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "import x\n" },
        ]);
    });

    it("нестроковые detail/documentation отбрасываются", () => {
        expect(parseWireResolvedCompletionItem({ detail: 5, documentation: {} })).toEqual({});
        expect(parseWireResolvedCompletionItem({ detail: "d" })).toEqual({ detail: "d" });
        expect(parseWireResolvedCompletionItem({ documentation: "doc" })).toEqual({ documentation: "doc" });
    });

    it("битые правки отбрасываются поштучно, не-объект → null", () => {
        const parsed = parseWireResolvedCompletionItem({
            additionalEdits: [null, { range: { startLine: "x" }, text: "a" }, { range: {}, text: 1 }],
        });
        expect(parsed).toEqual({});
        expect(parseWireResolvedCompletionItem(null)).toBeNull();
        expect(parseWireResolvedCompletionItem("nope")).toBeNull();
    });

    it("сквозь RPC: ответ доезжает, таймаут даёт null", async () => {
        const { host, sub, dispose } = connectPair();
        try {
            sub.handleRequest("languages.resolveCompletionItem", () => ({ detail: "resolved" }));
            const resolved = await requestResolveCompletionItem((m, p) => host.request(m, p), "1.0", 1000);
            expect(resolved?.detail).toBe("resolved");
        } finally {
            dispose();
        }

        const slow = connectPair();
        try {
            slow.sub.handleRequest("languages.resolveCompletionItem", () => new Promise(() => {}));
            expect(await requestResolveCompletionItem((m, p) => slow.host.request(m, p), "1.0", 30)).toBeNull();
        } finally {
            slow.dispose();
        }
    });
});

describe("WireTypes — parseWireCompletionResult", () => {
    it("не-объект и не-массив → пустой полный список", () => {
        expect(parseWireCompletionResult(null)).toEqual({ items: [], isIncomplete: false });
        expect(parseWireCompletionResult(42)).toEqual({ items: [], isIncomplete: false });
    });

    it("флаг isIncomplete читается только как true", () => {
        expect(parseWireCompletionResult({ items: [], isIncomplete: "yes" }).isIncomplete).toBe(false);
        expect(parseWireCompletionResult({ items: [], isIncomplete: true }).isIncomplete).toBe(true);
    });
});

describe("WireTypes — parseWireFoldingRanges", () => {
    it("оставляет валидные, отбрасывает битые (drop+skip)", () => {
        const raw = [
            { start: 0, end: 3, kind: 3 },
            { start: 5, end: 9 }, // без kind — ок
            { start: "x", end: 2 }, // битый start
            { end: 4 }, // нет start
            null,
            42,
        ];
        expect(parseWireFoldingRanges(raw)).toEqual([
            { start: 0, end: 3, kind: 3 },
            { start: 5, end: 9 },
        ]);
    });

    it("не-массив → []", () => {
        expect(parseWireFoldingRanges(null)).toEqual([]);
        expect(parseWireFoldingRanges({ start: 0, end: 1 })).toEqual([]);
    });
});

describe("WireTypes — wireToCoreFoldingRegions", () => {
    it("маппит в IFoldingRegion (несвёрнутые), kind отбрасывается", () => {
        expect(wireToCoreFoldingRegions([{ start: 0, end: 3, kind: 3 }])).toEqual([
            { startLine: 0, endLine: 3, isCollapsed: false },
        ]);
    });

    it("отбрасывает вырожденные (end <= start) и клампит start к нулю", () => {
        expect(
            wireToCoreFoldingRegions([
                { start: 2, end: 2 }, // прятать нечего
                { start: 4, end: 1 }, // end < start
                { start: -3, end: 2 }, // start клампится к 0
            ]),
        ).toEqual([{ startLine: 0, endLine: 2, isCollapsed: false }]);
    });
});

describe("WireTypes — requestFoldingRanges (InProcessChannelPair)", () => {
    function connectPair(): { host: RpcEndpoint; sub: RpcEndpoint; dispose: () => void } {
        const [a, b] = createInProcessChannelPair();
        const host = new RpcEndpoint(a);
        const sub = new RpcEndpoint(b);
        return {
            host,
            sub,
            dispose: () => {
                host.dispose();
                sub.dispose();
            },
        };
    }

    it("возвращает core-регионы ответа провайдера", async () => {
        const { host, sub, dispose } = connectPair();
        try {
            sub.handleRequest("languages.provideFoldingRanges", () => [
                { start: 1, end: 4, kind: 3 },
                { start: 6, end: 6 }, // вырожденный — отсеется
            ]);
            const regions = await requestFoldingRanges(
                (m, p) => host.request(m, p),
                { uri: Uri.file("/x.cs").toString(), languageId: "csharp", text: "" },
                1000,
            );
            expect(regions).toEqual([{ startLine: 1, endLine: 4, isCollapsed: false }]);
        } finally {
            dispose();
        }
    });

    it("таймаут → []", async () => {
        const { host, sub, dispose } = connectPair();
        try {
            sub.handleRequest("languages.provideFoldingRanges", () => new Promise(() => {})); // никогда не резолвится
            const regions = await requestFoldingRanges(
                (m, p) => host.request(m, p),
                { uri: Uri.file("/x.cs").toString(), languageId: "csharp", text: "" },
                20,
            );
            expect(regions).toEqual([]);
        } finally {
            dispose();
        }
    });
});

describe("WireTypes — parseWireSelections", () => {
    it("оставляет валидные, отбрасывает битые", () => {
        const raw = [
            { anchorLine: 0, anchorCharacter: 1, activeLine: 2, activeCharacter: 3 },
            { anchorLine: 0, anchorCharacter: 1, activeLine: 2 }, // неполный
            null,
        ];
        expect(parseWireSelections(raw)).toEqual([
            { anchorLine: 0, anchorCharacter: 1, activeLine: 2, activeCharacter: 3 },
        ]);
    });

    it("не-массив → []", () => {
        expect(parseWireSelections(undefined)).toEqual([]);
    });
});

describe("WireTypes — parseWireEditorEdits", () => {
    it("парсит правку с range+text; отбрасывает без range или без text", () => {
        const raw = [
            null,
            42,
            { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 2 }, text: "hi" },
            { text: "no range" },
            { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 2 } }, // нет text
            { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 2 }, text: 5 }, // text не строка
        ];
        expect(parseWireEditorEdits(raw)).toEqual([
            { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 2 }, text: "hi" },
        ]);
    });

    it("пустой text (delete) валиден", () => {
        const raw = [{ range: { startLine: 1, startCharacter: 0, endLine: 2, endCharacter: 0 }, text: "" }];
        expect(parseWireEditorEdits(raw)).toHaveLength(1);
    });

    it("не-массив → []", () => {
        expect(parseWireEditorEdits(null)).toEqual([]);
    });
});

// ─── Editor layout (полоса групп, window.tabGroups) ──────────────────────────

/** Минимальная валидная текстовая вкладка снимка. */
function layoutTab(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { uri: "file:///p/a.ts", label: "a.ts", isActive: true, isDirty: false, kind: "text", ...overrides };
}

/** Снимок с одной группой и переданными вкладками. */
function layoutOf(...tabs: Record<string, unknown>[]): Record<string, unknown> {
    return { groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs }] };
}

describe("WireTypes — parseWireEditorLayout", () => {
    it("парсит группы с текстовыми вкладками (обязательные поля)", () => {
        const raw = layoutOf(layoutTab(), layoutTab({ uri: "file:///p/b.ts", label: "b.ts", isActive: false }));
        expect(parseWireEditorLayout(raw)).toEqual(raw);
    });

    it("подхватывает опциональные original/modified/languageId/selections diff-вкладки", () => {
        const raw = layoutOf(
            layoutTab({
                kind: "diff",
                original: "git:///p/a.ts",
                modified: "file:///p/a.ts",
                languageId: "typescript",
                selections: [{ anchorLine: 0, anchorCharacter: 1, activeLine: 2, activeCharacter: 3 }],
            }),
        );
        expect(parseWireEditorLayout(raw)).toEqual(raw);
    });

    it("нестроковые original/modified/languageId и не-массив selections опускаются", () => {
        const parsed = parseWireEditorLayout(
            layoutOf(layoutTab({ original: 5, modified: null, languageId: 42, selections: "junk" })),
        );
        expect(parsed?.groups[0].tabs[0]).toEqual(layoutTab());
    });

    it("битые выделения внутри selections отбрасываются поштучно (drop+skip)", () => {
        const parsed = parseWireEditorLayout(
            layoutOf(
                layoutTab({
                    selections: [null, { anchorLine: 0, anchorCharacter: 0, activeLine: 0, activeCharacter: 2 }],
                }),
            ),
        );
        expect(parsed?.groups[0].tabs[0].selections).toEqual([
            { anchorLine: 0, anchorCharacter: 0, activeLine: 0, activeCharacter: 2 },
        ]);
    });

    it("не-объект и groups-не-массив → null", () => {
        expect(parseWireEditorLayout(null)).toBeNull();
        expect(parseWireEditorLayout("junk")).toBeNull();
        expect(parseWireEditorLayout({})).toBeNull();
        expect(parseWireEditorLayout({ groups: "x" })).toBeNull();
    });

    it("битая группа роняет весь снимок → null (снимок должен быть атомарным)", () => {
        const good = { groupId: 1, viewColumn: 1, isActive: true, tabs: [] };
        expect(parseWireEditorLayout({ groups: [null] })).toBeNull();
        expect(parseWireEditorLayout({ groups: [good, { ...good, groupId: "x" }] })).toBeNull();
        expect(parseWireEditorLayout({ groups: [{ ...good, viewColumn: Number.NaN }] })).toBeNull();
        expect(parseWireEditorLayout({ groups: [{ ...good, isActive: 1 }] })).toBeNull();
        expect(parseWireEditorLayout({ groups: [{ ...good, tabs: "x" }] })).toBeNull();
    });

    it("битая вкладка роняет весь снимок → null", () => {
        expect(parseWireEditorLayout(layoutOf({}))).toBeNull();
        expect(parseWireEditorLayout({ groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [42] }] })).toBeNull();
        expect(parseWireEditorLayout(layoutOf(layoutTab({ uri: "" })))).toBeNull();
        expect(parseWireEditorLayout(layoutOf(layoutTab({ label: 5 })))).toBeNull();
        expect(parseWireEditorLayout(layoutOf(layoutTab({ isActive: "yes" })))).toBeNull();
        expect(parseWireEditorLayout(layoutOf(layoutTab({ isDirty: null })))).toBeNull();
        expect(parseWireEditorLayout(layoutOf(layoutTab({ kind: "webview" })))).toBeNull();
    });
});

describe("WireTypes — parseWireShowTextDocumentParams", () => {
    it("минимальная форма — только uri; опциональные поля подхватываются", () => {
        expect(parseWireShowTextDocumentParams({ uri: "file:///a.ts" })).toEqual({ uri: "file:///a.ts" });
        expect(
            parseWireShowTextDocumentParams({ uri: "file:///a.ts", viewColumn: -2, preserveFocus: true }),
        ).toEqual({ uri: "file:///a.ts", viewColumn: -2, preserveFocus: true });
    });

    it("не-объект и пустой/нестроковый uri → null", () => {
        expect(parseWireShowTextDocumentParams(null)).toBeNull();
        expect(parseWireShowTextDocumentParams("file:///a.ts")).toBeNull();
        expect(parseWireShowTextDocumentParams({})).toBeNull();
        expect(parseWireShowTextDocumentParams({ uri: "" })).toBeNull();
    });

    it("кривые viewColumn/preserveFocus опускаются, uri остаётся", () => {
        expect(
            parseWireShowTextDocumentParams({ uri: "file:///a.ts", viewColumn: "beside", preserveFocus: 1 }),
        ).toEqual({ uri: "file:///a.ts" });
    });

    it("selection-объект парсится в wire-выделение", () => {
        const selection = { anchorLine: 1, anchorCharacter: 2, activeLine: 3, activeCharacter: 4 };
        expect(parseWireShowTextDocumentParams({ uri: "file:///a.ts", selection })).toEqual({
            uri: "file:///a.ts",
            selection,
        });
    });

    it("selection-массив и битый selection-объект опускаются", () => {
        // Массив — чужая форма (selection в этом запросе ровно один).
        const asArray = parseWireShowTextDocumentParams({
            uri: "file:///a.ts",
            selection: [{ anchorLine: 1, anchorCharacter: 2, activeLine: 3, activeCharacter: 4 }],
        });
        expect(asArray?.selection).toBeUndefined();
        const broken = parseWireShowTextDocumentParams({ uri: "file:///a.ts", selection: { anchorLine: "x" } });
        expect(broken?.selection).toBeUndefined();
    });
});

describe("WireTypes — parseWireCloseTabsParams", () => {
    it("парсит адресацию вкладок парами (groupId, uri)", () => {
        const raw = { tabs: [{ groupId: 1, uri: "file:///a.ts" }, { groupId: 2, uri: "file:///b.ts" }] };
        expect(parseWireCloseTabsParams(raw)).toEqual(raw);
    });

    it("не-объект и tabs-не-массив → null", () => {
        expect(parseWireCloseTabsParams(null)).toBeNull();
        expect(parseWireCloseTabsParams("junk")).toBeNull();
        expect(parseWireCloseTabsParams({})).toBeNull();
        expect(parseWireCloseTabsParams({ tabs: {} })).toBeNull();
    });

    it("битая вкладка роняет весь запрос → null (закрыть не то — хуже, чем не закрыть)", () => {
        expect(parseWireCloseTabsParams({ tabs: [null] })).toBeNull();
        expect(parseWireCloseTabsParams({ tabs: [{ groupId: "x", uri: "file:///a.ts" }] })).toBeNull();
        expect(parseWireCloseTabsParams({ tabs: [{ groupId: 1, uri: 42 }] })).toBeNull();
    });
});

describe("WireTypes — parseWireCloseGroupsParams", () => {
    it("парсит массив числовых id групп", () => {
        expect(parseWireCloseGroupsParams({ groupIds: [1, 2] })).toEqual({ groupIds: [1, 2] });
        expect(parseWireCloseGroupsParams({ groupIds: [] })).toEqual({ groupIds: [] });
    });

    it("не-объект, не-массив и нечисловой id → null", () => {
        expect(parseWireCloseGroupsParams(null)).toBeNull();
        expect(parseWireCloseGroupsParams("junk")).toBeNull();
        expect(parseWireCloseGroupsParams({})).toBeNull();
        expect(parseWireCloseGroupsParams({ groupIds: [1, "2"] })).toBeNull();
        expect(parseWireCloseGroupsParams({ groupIds: [Number.NaN] })).toBeNull();
    });
});

describe("WireTypes — reviveWireUri", () => {
    it("строка → Uri.parse", () => {
        expect(reviveWireUri("file:///p/a.ts")?.toString()).toBe(Uri.file("/p/a.ts").toString());
    });

    it("компонентный JSON (toJSON-форма vscode.Uri) поднимается со всеми полями", () => {
        const revived = reviveWireUri({
            scheme: "git",
            authority: "host",
            path: "/p/a.ts",
            query: "ref=HEAD",
            fragment: "L1",
        });
        expect(revived?.scheme).toBe("git");
        expect(revived?.authority).toBe("host");
        expect(revived?.path).toBe("/p/a.ts");
        expect(revived?.query).toBe("ref=HEAD");
        expect(revived?.fragment).toBe("L1");
    });

    it("нестроковые компоненты опускаются, scheme обязателен", () => {
        const revived = reviveWireUri({ scheme: "diode", authority: 5, path: null, query: [], fragment: {} });
        expect(revived?.scheme).toBe("diode");
        expect(revived?.authority).toBe("");
        expect(revived?.path).toBe("");
        expect(revived?.query).toBe("");
        expect(revived?.fragment).toBe("");
    });

    it("мусор → null: пустая строка, не-объект, объект без scheme", () => {
        expect(reviveWireUri("")).toBeNull();
        expect(reviveWireUri(null)).toBeNull();
        expect(reviveWireUri(42)).toBeNull();
        expect(reviveWireUri({})).toBeNull();
        expect(reviveWireUri({ scheme: "" })).toBeNull();
        expect(reviveWireUri({ scheme: 5 })).toBeNull();
    });
});

describe("parseWireReadFileResult", () => {
    it("разбирает base64 в байты", () => {
        const content = Buffer.from("оригинал", "utf8").toString("base64");
        expect(new TextDecoder().decode(parseWireReadFileResult({ content }))).toBe("оригинал");
    });

    it("пустое содержимое — валидный результат", () => {
        expect(parseWireReadFileResult({ content: "" })).toEqual(new Uint8Array());
    });

    it.each([null, undefined, 42, "строка", []])("структурно чужой ответ (%s) — ошибка", (raw) => {
        expect(() => parseWireReadFileResult(raw)).toThrow(/workspace\.fs\.readFile/);
    });

    it("нестроковый content — ошибка", () => {
        expect(() => parseWireReadFileResult({ content: 42 })).toThrow(/base64 string/);
    });
});
