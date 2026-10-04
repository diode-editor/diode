import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IGutterChangeDecoration } from "../../../../../editor/common/model/iGutterChangeDecoration.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { ColorThemeKind } from "../../../../api/common/vscodeTypes.ts";

import { DecorationsCustomer } from "./decorationsCustomer.ts";

const MOD = 0x1b81a8;
const ADD = 0x487e02;
const FILE = 0x112233;
const COLORS: Record<string, number> = {
    "editorGutter.modifiedBackground": MOD,
    "editorGutter.addedBackground": ADD,
    "gitDecoration.modifiedResourceForeground": FILE,
};

/**
 * Customer на паре in-process каналов: `peer` играет субпроцесс. `rpcLogger.warn`
 * ловит исключения обработчиков нотификаций — RpcEndpoint их глотает и пишет сюда.
 */
function setup(colors: Record<string, number> = COLORS) {
    const editorCalls: { uri: string; decorations: readonly IGutterChangeDecoration[] }[] = [];
    const fileCalls: { path: string; color?: number; badge?: string }[][] = [];
    const themeListeners: (() => void)[] = [];
    let kind = ColorThemeKind.Dark;
    const customer = new DecorationsCustomer(
        { setGutterChangeDecorations: (uri, decorations) => editorCalls.push({ uri, decorations }) },
        { setFileDecorations: (entries) => fileCalls.push([...entries]) },
        {
            resolve: (id) => colors[id],
            kind: () => kind,
            onDidChange: (cb) => {
                themeListeners.push(cb);
                return { dispose: () => undefined };
            },
        },
    );
    const [a, b] = createInProcessChannelPair();
    const rpcLogger = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isEnabled: () => true,
    };
    const peer = new RpcEndpoint(b);
    const themes: unknown[] = [];
    peer.handleNotification("window.themeChanged", (params) => themes.push(params));
    const attached = customer.attach({ rpc: new RpcEndpoint(a, rpcLogger), logger: undefined });
    return {
        peer,
        attached,
        customer,
        editorCalls,
        fileCalls,
        themes,
        rpcLogger,
        changeTheme: (next: ColorThemeKind) => {
            kind = next;
            for (const cb of themeListeners) cb();
        },
        editorCallsFor: (file: string) => editorCalls.filter((c) => c.uri === Uri.file(file).toString()),
    };
}

const range = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } });
const gutter = (themeColor: string) => ({ overviewRulerColor: { $themeColor: themeColor }, isWholeLine: true });

describe("DecorationsCustomer — gutter-декорации редактора", () => {
    it("битые параметры отбрасываются без падения и без вызова поверхности", async () => {
        const h = setup();

        h.peer.notify("window.createTextEditorDecorationType", { key: "nope" });
        h.peer.notify("window.disposeTextEditorDecorationType", { key: "nope" });
        h.peer.notify("editor.setDecorations", { key: "nope", uri: Uri.file("/a.ts").toString() });
        h.peer.notify("editor.setDecorations", { key: 5, uri: 42 });
        await flushMicrotasks(10);

        expect(h.editorCalls).toEqual([]);
        expect(h.rpcLogger.warn).not.toHaveBeenCalled();
    });

    it("gutter-тип красится цветом темы, не-gutter и неизвестный тип игнорируются", async () => {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 1,
            options: gutter("editorGutter.addedBackground"),
        });
        h.peer.notify("window.createTextEditorDecorationType", { key: 2, options: { backgroundColor: "red" } });
        h.peer.notify("window.createTextEditorDecorationType", { key: 3 });
        h.peer.notify("window.createTextEditorDecorationType", { key: 4, options: null });
        h.peer.notify("window.createTextEditorDecorationType", { key: 6, options: gutter("no.such.color") });
        await flushMicrotasks(10);

        const uri = Uri.file("/a.ts").toString();
        for (const key of [1, 2, 3, 4, 5, 6])
            h.peer.notify("editor.setDecorations", { key, uri, ranges: [range(key)] });
        await flushMicrotasks(10);

        expect(h.editorCallsFor("/a.ts").at(-1)?.decorations).toStrictEqual([{ range: range(1), color: ADD }]);
        expect(h.rpcLogger.warn).not.toHaveBeenCalled();
    });

    it("modified-гуттер штрихуется, added — сплошной", async () => {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 1,
            options: gutter("editorGutter.modifiedBackground"),
        });
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 2,
            options: gutter("editorGutter.addedBackground"),
        });
        await flushMicrotasks(10);
        const uri = Uri.file("/f.ts").toString();
        h.peer.notify("editor.setDecorations", { key: 1, uri, ranges: [range(2)] });
        h.peer.notify("editor.setDecorations", { key: 2, uri, ranges: [range(5)] });
        await flushMicrotasks(10);

        expect(h.editorCallsFor("/f.ts").at(-1)?.decorations).toStrictEqual([
            { range: range(2), color: MOD, dashed: true },
            { range: range(5), color: ADD },
        ]);
    });

    it("пустой набор снимает бары; снятие типа перерисовывает только файлы, где он был", async () => {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 1,
            options: gutter("editorGutter.addedBackground"),
        });
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 2,
            options: gutter("editorGutter.addedBackground"),
        });
        await flushMicrotasks(10);
        h.peer.notify("editor.setDecorations", { key: 1, uri: Uri.file("/a.ts").toString(), ranges: [range(1)] });
        h.peer.notify("editor.setDecorations", { key: 2, uri: Uri.file("/b.ts").toString(), ranges: [range(1)] });
        await flushMicrotasks(10);

        h.peer.notify("editor.setDecorations", { key: 2, uri: Uri.file("/b.ts").toString(), ranges: [] });
        await flushMicrotasks(10);
        expect(h.editorCallsFor("/b.ts").at(-1)?.decorations).toStrictEqual([]);

        const before = h.editorCalls.length;
        h.peer.notify("window.disposeTextEditorDecorationType", { key: 1 });
        await flushMicrotasks(10);

        // Перерисован ровно файл, где тип был.
        expect(h.editorCalls.slice(before)).toStrictEqual([{ uri: Uri.file("/a.ts").toString(), decorations: [] }]);

        // Снятый тип больше не рисуется, даже если субпроцесс пришлёт его набор.
        h.peer.notify("editor.setDecorations", { key: 1, uri: Uri.file("/a.ts").toString(), ranges: [range(3)] });
        await flushMicrotasks(10);
        expect(h.editorCallsFor("/a.ts").at(-1)?.decorations).toStrictEqual([]);
    });
});

describe("DecorationsCustomer — декорации файлов", () => {
    it("badge и цвет по отдельности; не-file отбрасывается; голый uri снимает", async () => {
        const h = setup();
        h.peer.notify("window.fileDecorationsChanged", {
            decorations: [
                { uri: "file:///both.md", badge: "M", colorId: "gitDecoration.modifiedResourceForeground" },
                { uri: "file:///badge.md", badge: "A" },
                { uri: "file:///color.md", colorId: "gitDecoration.modifiedResourceForeground" },
                { uri: "file:///unknown-color.md", colorId: "no.such.color" },
                { uri: "untitled:scratch", badge: "U" },
            ],
        });
        await flushMicrotasks(10);
        expect(h.fileCalls.at(-1)).toStrictEqual([
            { path: "/both.md", color: FILE, badge: "M" },
            { path: "/badge.md", badge: "A" },
            { path: "/color.md", color: FILE },
            { path: "/unknown-color.md" },
        ]);

        h.peer.notify("window.fileDecorationsChanged", { decorations: [{ uri: "file:///both.md" }] });
        await flushMicrotasks(10);
        expect(h.fileCalls.at(-1)?.map((e) => e.path)).toEqual(["/badge.md", "/color.md", "/unknown-color.md"]);
    });
});

describe("DecorationsCustomer — тема", () => {
    it("смена темы пере-резолвит держимые декорации и шлёт новую тему живому спавну", async () => {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 1,
            options: gutter("editorGutter.addedBackground"),
        });
        await flushMicrotasks(10);
        h.peer.notify("editor.setDecorations", { key: 1, uri: Uri.file("/a.ts").toString(), ranges: [range(1)] });
        h.peer.notify("window.fileDecorationsChanged", { decorations: [{ uri: "file:///x.md", badge: "M" }] });
        await flushMicrotasks(10);
        const editorBefore = h.editorCalls.length;
        const fileBefore = h.fileCalls.length;

        h.changeTheme(ColorThemeKind.Light);
        await flushMicrotasks(10);

        expect(h.editorCalls.slice(editorBefore)).toStrictEqual([
            { uri: Uri.file("/a.ts").toString(), decorations: [{ range: range(1), color: ADD }] },
        ]);
        expect(h.fileCalls.slice(fileBefore)).toStrictEqual([[{ path: "/x.md", badge: "M" }]]);
        expect(h.themes).toEqual([{ kind: ColorThemeKind.Light }]);
    });

    it("после ухода спавна смена темы ничего не перерисовывает и никому не пишет", async () => {
        const h = setup();
        h.attached.dispose();

        h.changeTheme(ColorThemeKind.Light);
        h.customer.pushActiveColorTheme();
        await flushMicrotasks(10);

        expect(h.editorCalls).toEqual([]);
        expect(h.fileCalls).toEqual([]);
        expect(h.themes).toEqual([]);
    });

    it("pushActiveColorTheme шлёт текущий вид живому спавну", async () => {
        const h = setup();

        h.customer.pushActiveColorTheme();
        await flushMicrotasks(10);

        expect(h.themes).toEqual([{ kind: ColorThemeKind.Dark }]);
    });
});
