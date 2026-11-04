import { packRgb, packRgba, TRANSPARENT_COLOR } from "@tuidom/core/common/colorUtils";
import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IExtensionTextDecoration } from "../../../../../editor/common/model/iExtensionTextDecoration.ts";
import type { IGutterChangeDecoration } from "../../../../../editor/common/model/iGutterChangeDecoration.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { ColorThemeKind } from "../../../../api/common/vscodeTypes.ts";

import { DecorationsCustomer } from "./decorationsCustomer.ts";

const MOD = 0x1b81a8;
const ADD = 0x487e02;
const FILE = 0x112233;
const MERGE = packRgba(0x40, 0xc8, 0xae, 0x33);
const FG = packRgb(0xcc, 0xcc, 0xcc);
const COLORS: Record<string, number> = {
    "merge.currentContentBackground": MERGE,
    "editor.foreground": FG,
    "editorGutter.modifiedBackground": MOD,
    "editorGutter.addedBackground": ADD,
    "gitDecoration.modifiedResourceForeground": FILE,
};

/** `rpcLogger.warn` catches notification handler exceptions — RpcEndpoint swallows them. */
function setup(colors: Record<string, number> = COLORS) {
    const editorCalls: { uri: string; decorations: readonly IGutterChangeDecoration[] }[] = [];
    const textCalls: { uri: string; decorations: readonly IExtensionTextDecoration[] }[] = [];
    const fileCalls: { path: string; color?: number; badge?: string }[][] = [];
    const themeListeners: (() => void)[] = [];
    let kind = ColorThemeKind.Dark;
    const customer = new DecorationsCustomer(
        {
            setGutterChangeDecorations: (uri, decorations) => editorCalls.push({ uri, decorations }),
            setExtensionTextDecorations: (uri, decorations) => textCalls.push({ uri, decorations }),
        },
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
        textFor: (file: string) => textCalls.filter((c) => c.uri === Uri.file(file).toString()).at(-1)?.decorations,
    };
}

const range = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } });
const gutter = (themeColor: string) => ({ overviewRulerColor: { $themeColor: themeColor }, isWholeLine: true });

describe("DecorationsCustomer — editor gutter decorations", () => {
    it("broken params are dropped without a crash and without calling the surface", async () => {
        const h = setup();

        h.peer.notify("window.createTextEditorDecorationType", { key: "nope" });
        h.peer.notify("window.disposeTextEditorDecorationType", { key: "nope" });
        h.peer.notify("editor.setDecorations", { key: "nope", uri: Uri.file("/a.ts").toString() });
        h.peer.notify("editor.setDecorations", { key: 5, uri: 42 });
        await flushMicrotasks(10);

        expect(h.editorCalls).toEqual([]);
        expect(h.rpcLogger.warn).not.toHaveBeenCalled();
    });

    it("a gutter type is colored with the theme color, non-gutter and unknown types are ignored", async () => {
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

    it("modified gutter is hatched, added is solid", async () => {
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

    it("an empty set removes the bars; removing a type redraws only files where it was", async () => {
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

        expect(h.editorCalls.slice(before)).toStrictEqual([{ uri: Uri.file("/a.ts").toString(), decorations: [] }]);

        // A disposed type is no longer drawn, even if the subprocess sends a set for it.
        h.peer.notify("editor.setDecorations", { key: 1, uri: Uri.file("/a.ts").toString(), ranges: [range(3)] });
        await flushMicrotasks(10);
        expect(h.editorCallsFor("/a.ts").at(-1)?.decorations).toStrictEqual([]);
    });
});

describe("DecorationsCustomer — file decorations", () => {
    it("badge and color separately; non-file is dropped; a bare uri removes", async () => {
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

    it("propagate reaches the tree as is and updates with the next set", async () => {
        const h = setup();
        h.peer.notify("window.fileDecorationsChanged", {
            decorations: [
                { uri: "file:///up.md", badge: "M", propagate: true },
                { uri: "file:///gone.md", badge: "D", propagate: false },
            ],
        });
        await flushMicrotasks(10);
        expect(h.fileCalls.at(-1)).toStrictEqual([
            { path: "/up.md", badge: "M", propagate: true },
            { path: "/gone.md", badge: "D", propagate: false },
        ]);

        h.peer.notify("window.fileDecorationsChanged", { decorations: [{ uri: "file:///up.md", badge: "M" }] });
        await flushMicrotasks(10);
        expect(h.fileCalls.at(-1)?.[0]).toStrictEqual({ path: "/up.md", badge: "M" });
    });
});

describe("DecorationsCustomer — theme", () => {
    it("a theme change re-resolves held decorations and sends the new theme to a live spawn", async () => {
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

    it("after the spawn exits a theme change redraws nothing and notifies no one", async () => {
        const h = setup();
        h.attached.dispose();

        h.changeTheme(ColorThemeKind.Light);
        h.customer.pushActiveColorTheme();
        await flushMicrotasks(10);

        expect(h.editorCalls).toEqual([]);
        expect(h.fileCalls).toEqual([]);
        expect(h.themes).toEqual([]);
    });

    it("pushActiveColorTheme sends the current theme kind to a live spawn", async () => {
        const h = setup();

        h.customer.pushActiveColorTheme();
        await flushMicrotasks(10);

        expect(h.themes).toEqual([{ kind: ColorThemeKind.Dark }]);
    });
});

const span = (line: number, from: number, to: number) => ({
    start: { line, character: from },
    end: { line, character: to },
});
const A_TS = Uri.file("/a.ts").toString();

describe("DecorationsCustomer — text decorations", () => {
    async function typed(options: unknown, ranges: unknown[] = [span(0, 5, 8)]) {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", { key: 1, options });
        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges });
        await flushMicrotasks(10);
        return h;
    }

    it("[api:window.createTextEditorDecorationType] a CSS string background is parsed into packed RGBA, alpha kept", async () => {
        const h = await typed({
            borderRadius: "3px",
            borderWidth: "1px",
            borderStyle: "solid",
            backgroundColor: "rgba(255,0,0,0.3)",
            borderColor: "rgba(255,100,100,0.15)",
        });
        expect(h.textFor("/a.ts")).toStrictEqual([
            { range: span(0, 5, 8), bg: packRgba(255, 0, 0, 77), isWholeLine: false },
        ]);
        // No overviewRulerColor — no gutter bars.
        expect(h.editorCallsFor("/a.ts").at(-1)?.decorations).toStrictEqual([]);
    });

    it("[api:window.createTextEditorDecorationType] a ThemeColor resolves through the theme; isWholeLine and color travel along", async () => {
        const h = await typed({
            isWholeLine: true,
            backgroundColor: { $themeColor: "merge.currentContentBackground" },
            color: { $themeColor: "editor.foreground" },
        });
        expect(h.textFor("/a.ts")).toStrictEqual([{ range: span(0, 5, 8), bg: MERGE, fg: FG, isWholeLine: true }]);
    });

    it("a type that is both a gutter bar and a background feeds both channels", async () => {
        const h = await typed({
            overviewRulerColor: { $themeColor: "editorGutter.addedBackground" },
            backgroundColor: "#102030",
        });
        expect(h.editorCallsFor("/a.ts").at(-1)?.decorations).toStrictEqual([{ range: span(0, 5, 8), color: ADD }]);
        expect(h.textFor("/a.ts")).toStrictEqual([
            { range: span(0, 5, 8), bg: packRgb(0x10, 0x20, 0x30), isWholeLine: false },
        ]);
    });

    it("garbage colors are no color, the other fields of the type live on", async () => {
        const h = await typed({
            backgroundColor: "rgba(1,2)",
            color: "#ggg",
            // A non-ASCII word.
            light: { backgroundColor: "\u043a\u0438\u0440\u043f\u0438\u0447" },
            dark: { color: "green" },
        });
        expect(h.textFor("/a.ts")).toStrictEqual([
            { range: span(0, 5, 8), fg: packRgb(0, 128, 0), isWholeLine: false },
        ]);
        expect(h.rpcLogger.warn).not.toHaveBeenCalled();
    });

    it("a type without background and color paints no text, and neither does a non-object branch", async () => {
        const h = await typed({ isWholeLine: true, light: "red", dark: 5, borderColor: "red" });
        expect(h.textFor("/a.ts")).toStrictEqual([]);
    });

    it("an unknown theme color id is no color, even in the branch of the current theme", async () => {
        const h = await typed({ color: "red", dark: { backgroundColor: { $themeColor: "no.such.color" } } });
        expect(h.textFor("/a.ts")).toStrictEqual([
            { range: span(0, 5, 8), fg: packRgb(255, 0, 0), isWholeLine: false },
        ]);
    });

    it("transparent goes through as a color that paints nothing", async () => {
        const h = await typed({ backgroundColor: "transparent" });
        expect(h.textFor("/a.ts")).toStrictEqual([{ range: span(0, 5, 8), bg: TRANSPARENT_COLOR, isWholeLine: false }]);
    });

    it("the branch of the current theme kind wins over the base field, a missing branch field falls back to it", async () => {
        const h = await typed({
            backgroundColor: "#000001",
            color: "#000002",
            light: { backgroundColor: "#ffff01" },
            dark: { backgroundColor: "#330001", color: { $themeColor: "editor.foreground" } },
        });
        expect(h.textFor("/a.ts")).toStrictEqual([
            { range: span(0, 5, 8), bg: packRgb(0x33, 0, 1), fg: FG, isWholeLine: false },
        ]);

        h.changeTheme(ColorThemeKind.Light);
        expect(h.textFor("/a.ts")).toStrictEqual([
            { range: span(0, 5, 8), bg: packRgb(0xff, 0xff, 1), fg: packRgb(0, 0, 2), isWholeLine: false },
        ]);
        h.changeTheme(ColorThemeKind.HighContrastLight);
        expect(h.textFor("/a.ts")?.[0].bg).toBe(packRgb(0xff, 0xff, 1));
        h.changeTheme(ColorThemeKind.HighContrast);
        expect(h.textFor("/a.ts")?.[0].bg).toBe(packRgb(0x33, 0, 1));
    });

    it("[api:TextEditor.setDecorations] types paint in creation order whatever order their sets came in; ranges keep theirs", async () => {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", { key: 1, options: { backgroundColor: "#000001" } });
        h.peer.notify("window.createTextEditorDecorationType", { key: 2, options: { backgroundColor: "#000002" } });
        h.peer.notify("editor.setDecorations", { key: 2, uri: A_TS, ranges: [span(3, 0, 1), span(1, 0, 1)] });
        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [span(2, 0, 1)] });
        await flushMicrotasks(10);

        expect(h.textFor("/a.ts")?.map((d) => [d.bg, d.range.start.line])).toStrictEqual([
            [packRgb(0, 0, 1), 2],
            [packRgb(0, 0, 2), 3],
            [packRgb(0, 0, 2), 1],
        ]);
    });

    it("the spawn going away clears its text and gutter decorations in the editors", async () => {
        const h = await typed({
            backgroundColor: "red",
            overviewRulerColor: { $themeColor: "editorGutter.addedBackground" },
        });
        expect(h.textFor("/a.ts")).toHaveLength(1);

        h.attached.dispose();

        expect(h.textFor("/a.ts")).toStrictEqual([]);
        expect(h.editorCallsFor("/a.ts").at(-1)?.decorations).toStrictEqual([]);
    });

    it("[api:TextEditor.setDecorations] a repeated set replaces the type's set, an empty one and dispose remove it", async () => {
        const h = await typed({ backgroundColor: "red" });
        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [span(4, 0, 2)] });
        await flushMicrotasks(10);
        expect(h.textFor("/a.ts")?.map((d) => d.range)).toStrictEqual([span(4, 0, 2)]);

        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [] });
        await flushMicrotasks(10);
        expect(h.textFor("/a.ts")).toStrictEqual([]);

        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [span(4, 0, 2)] });
        h.peer.notify("window.disposeTextEditorDecorationType", { key: 1 });
        await flushMicrotasks(10);
        expect(h.textFor("/a.ts")).toStrictEqual([]);
    });
});
