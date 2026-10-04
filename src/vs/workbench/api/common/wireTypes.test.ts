import { describe, expect, it, vi } from "vitest";

import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import { Uri } from "../../../base/common/uri.ts";
import { EndOfLine } from "../../../editor/common/core/endOfLine.ts";

import type { HostRpc } from "./extHostProtocol.ts";
import { createInProcessChannelPair } from "./inProcessChannelPair.ts";
import { RpcEndpoint } from "./rpcEndpoint.ts";
import type { WireTextEdit } from "./wireTypes.ts";
import {
    parseWireCloseGroupsParams,
    parseWireCloseTabsParams,
    parseWireEditorEdits,
    parseWireEditorLayout,
    parseWireReadFileResult,
    parseWireSelections,
    parseWireShowTextDocumentParams,
    requestWillSaveEdits,
    reviveWireUri,
    wireToCoreFoldingRegions,
    wireToSaveEdits,
} from "./wireTypes.ts";

const PARAMS = {
    uri: Uri.file("/tmp/file.txt").toString(),
    languageId: "plaintext",
    version: 1,
    isDirty: true,
    reason: 1,
    eol: 1,
};

/**
 * Обработчик, который никогда не отвечает, и его токен: истёкший срок обязан
 * отменить запрос и на стороне субпроцесса (`$/cancelRequest`).
 */
function hangingHandler(): {
    handler: (params: unknown, token: ICancellationToken) => Promise<never>;
    token: () => ICancellationToken | undefined;
} {
    let seen: ICancellationToken | undefined;
    return {
        handler: (_params, token) => {
            seen = token;
            return new Promise<never>(() => undefined);
        },
        token: () => seen,
    };
}

/** Срок истёк — запрос отменён и у обработчика субпроцесса. */
async function expectCancelledOnPeer(hang: ReturnType<typeof hangingHandler>): Promise<void> {
    await vi.waitFor(() => {
        expect(hang.token()?.isCancellationRequested).toBe(true);
    });
}

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
    function connectPair(): { host: HostRpc; sub: RpcEndpoint; dispose: () => void } {
        const [a, b] = createInProcessChannelPair();
        const host: HostRpc = new RpcEndpoint(a);
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
            const edits = await requestWillSaveEdits((m, p, o) => host.request(m, p, o), PARAMS, 1000);
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
            const hang = hangingHandler();
            sub.handleRequest("workspace.willSaveTextDocument", hang.handler);
            const edits = await requestWillSaveEdits((m, p, o) => host.request(m, p, o), PARAMS, 30);
            expect(edits).toEqual([]);
            await expectCancelledOnPeer(hang);
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
            const edits = await requestWillSaveEdits((m, p, o) => host.request(m, p, o), PARAMS, 1000);
            expect(edits).toEqual([]);
        } finally {
            dispose();
        }
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

    it("принимает вкладку чужого вида (kind=unknown)", () => {
        const raw = layoutOf(layoutTab({ uri: "keybindings:global", kind: "unknown" }));
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
        expect(
            parseWireEditorLayout({ groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [42] }] }),
        ).toBeNull();
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
        expect(parseWireShowTextDocumentParams({ uri: "file:///a.ts", viewColumn: -2, preserveFocus: true })).toEqual({
            uri: "file:///a.ts",
            viewColumn: -2,
            preserveFocus: true,
        });
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
        const raw = {
            tabs: [
                { groupId: 1, uri: "file:///a.ts" },
                { groupId: 2, uri: "file:///b.ts" },
            ],
        };
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
