import { packRgb, packRgba, TRANSPARENT_COLOR } from "@tuidom/core/common/colorUtils";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type {
    IExtensionTextDecoration,
    IExtensionTextDecorationSet,
} from "../../../../../editor/common/model/iExtensionTextDecoration.ts";
import type { IGlyphMarginDecoration } from "../../../../../editor/common/model/iGlyphMarginDecoration.ts";
import type { IOverviewRulerDecoration } from "../../../../../editor/common/model/iOverviewRulerDecoration.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { ColorThemeKind } from "../../../../api/common/vscodeTypes.ts";

import { DecorationsCustomer, type GutterIconReader } from "./decorationsCustomer.ts";

const ADD = 0x487e02;
const FILE = 0x112233;
const MERGE = packRgba(0x40, 0xc8, 0xae, 0x33);
const FG = packRgb(0xcc, 0xcc, 0xcc);
const COLORS: Record<string, number> = {
    "merge.currentContentBackground": MERGE,
    "editor.foreground": FG,
    "editorGutter.addedBackground": ADD,
    "gitDecoration.modifiedResourceForeground": FILE,
};

/** `rpcLogger.warn` catches notification handler exceptions — RpcEndpoint swallows them. */
function setup(colors: Record<string, number> = COLORS, readGutterIcon?: GutterIconReader) {
    const editorCalls: { uri: string; decorations: readonly IOverviewRulerDecoration[] }[] = [];
    const glyphCalls: { uri: string; owner: string; decorations: readonly IGlyphMarginDecoration[] }[] = [];
    const textCalls: { uri: string; set: IExtensionTextDecorationSet }[] = [];
    const fileCalls: { path: string; color?: number; badge?: string }[][] = [];
    const themeListeners: (() => void)[] = [];
    let kind = ColorThemeKind.Dark;
    const customer = new DecorationsCustomer(
        {
            setOverviewRulerDecorations: (uri, decorations) => editorCalls.push({ uri, decorations }),
            setExtensionTextDecorations: (uri, set) => textCalls.push({ uri, set }),
            setGlyphMarginDecorations: (uri, owner, decorations) => glyphCalls.push({ uri, owner, decorations }),
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
        readGutterIcon,
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
        glyphCalls,
        /** The glyphs the editor holds for the owner: its last set. */
        glyphsFor: (file: string, owner: string) =>
            glyphCalls.filter((c) => c.uri === Uri.file(file).toString() && c.owner === owner).at(-1)?.decorations,
        fileCalls,
        themes,
        rpcLogger,
        changeTheme: (next: ColorThemeKind) => {
            kind = next;
            for (const cb of themeListeners) cb();
        },
        editorCallsFor: (file: string) => editorCalls.filter((c) => c.uri === Uri.file(file).toString()),
        textCalls,
        /**
         * What the editor holds: the last set of each type, in key order, without decorations that draw nothing
         * (`ExtensionTextDecorations` paints and inserts nothing for them).
         */
        textFor: (file: string) => {
            const byKey = new Map<number, readonly IExtensionTextDecoration[]>();
            for (const { uri, set } of textCalls)
                if (uri === Uri.file(file).toString()) byKey.set(set.key, set.decorations);
            return [...byKey]
                .sort(([a], [b]) => a - b)
                .flatMap(([, decorations]) => decorations)
                .filter(
                    (d) =>
                        d.bg !== undefined ||
                        d.fg !== undefined ||
                        d.style !== undefined ||
                        d.opacity !== undefined ||
                        d.before !== undefined ||
                        d.after !== undefined ||
                        d.hoverMessage !== undefined,
                );
        },
    };
}

const range = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } });
const gutter = (themeColor: string) => ({ overviewRulerColor: { $themeColor: themeColor }, isWholeLine: true });

describe("DecorationsCustomer — overview ruler marks", () => {
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

    it("[api:ThemableDecorationRenderOptions.overviewRulerColor] a ThemeColor resolves through the theme, types without it or with an unknown one mark nothing", async () => {
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
            h.peer.notify("editor.setDecorations", { key, uri, ranges: [{ range: range(key) }] });
        await flushMicrotasks(10);

        expect(h.editorCallsFor("/a.ts").at(-1)?.decorations).toStrictEqual([{ range: range(1), color: ADD }]);
        expect(h.rpcLogger.warn).not.toHaveBeenCalled();
    });

    it("[api:ThemableDecorationRenderOptions.overviewRulerColor] a CSS string is parsed like the other colors, the theme branch wins", async () => {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", { key: 1, options: { overviewRulerColor: "#ff0000" } });
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 2,
            options: { overviewRulerColor: "rgba(0,0,255,0.5)", light: { overviewRulerColor: "lime" } },
        });
        h.peer.notify("window.createTextEditorDecorationType", { key: 3, options: { overviewRulerColor: "nonsense" } });
        await flushMicrotasks(10);
        const uri = Uri.file("/f.ts").toString();
        for (const key of [1, 2, 3])
            h.peer.notify("editor.setDecorations", { key, uri, ranges: [{ range: range(key) }] });
        await flushMicrotasks(10);

        expect(h.editorCallsFor("/f.ts").at(-1)?.decorations).toStrictEqual([
            { range: range(1), color: packRgba(255, 0, 0, 255) },
            { range: range(2), color: packRgba(0, 0, 255, 128) },
        ]);

        h.changeTheme(ColorThemeKind.Light);
        await flushMicrotasks(10);
        expect(h.editorCallsFor("/f.ts").at(-1)?.decorations).toStrictEqual([
            { range: range(1), color: packRgba(255, 0, 0, 255) },
            { range: range(2), color: packRgba(0, 255, 0, 255) },
        ]);
    });

    it("an empty set removes the marks; removing a type redraws only files where it was", async () => {
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
        h.peer.notify("editor.setDecorations", {
            key: 1,
            uri: Uri.file("/a.ts").toString(),
            ranges: [{ range: range(1) }],
        });
        h.peer.notify("editor.setDecorations", {
            key: 2,
            uri: Uri.file("/b.ts").toString(),
            ranges: [{ range: range(1) }],
        });
        await flushMicrotasks(10);

        h.peer.notify("editor.setDecorations", { key: 2, uri: Uri.file("/b.ts").toString(), ranges: [] });
        await flushMicrotasks(10);
        expect(h.editorCallsFor("/b.ts").at(-1)?.decorations).toStrictEqual([]);

        const before = h.editorCalls.length;
        h.peer.notify("window.disposeTextEditorDecorationType", { key: 1 });
        await flushMicrotasks(10);

        expect(h.editorCalls.slice(before)).toStrictEqual([{ uri: Uri.file("/a.ts").toString(), decorations: [] }]);

        // A disposed type is no longer drawn, even if the subprocess sends a set for it.
        h.peer.notify("editor.setDecorations", {
            key: 1,
            uri: Uri.file("/a.ts").toString(),
            ranges: [{ range: range(3) }],
        });
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
        h.peer.notify("editor.setDecorations", {
            key: 1,
            uri: Uri.file("/a.ts").toString(),
            ranges: [{ range: range(1) }],
        });
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
    async function typed(options: unknown, ranges: unknown[] = [{ range: span(0, 5, 8) }]) {
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
        // No overviewRulerColor — no scrollbar marks.
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

    it("a type that is both a scrollbar mark and a background feeds both channels", async () => {
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
        expect(h.textFor("/a.ts")[0].bg).toBe(packRgb(0xff, 0xff, 1));
        h.changeTheme(ColorThemeKind.HighContrast);
        expect(h.textFor("/a.ts")[0].bg).toBe(packRgb(0x33, 0, 1));
    });

    it("[api:TextEditor.setDecorations] types paint in creation order whatever order their sets came in; ranges keep theirs", async () => {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", { key: 1, options: { backgroundColor: "#000001" } });
        h.peer.notify("window.createTextEditorDecorationType", { key: 2, options: { backgroundColor: "#000002" } });
        h.peer.notify("editor.setDecorations", {
            key: 2,
            uri: A_TS,
            ranges: [{ range: span(3, 0, 1) }, { range: span(1, 0, 1) }],
        });
        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [{ range: span(2, 0, 1) }] });
        await flushMicrotasks(10);

        expect(h.textFor("/a.ts").map((d) => [d.bg, d.range.start.line])).toStrictEqual([
            [packRgb(0, 0, 1), 2],
            [packRgb(0, 0, 2), 3],
            [packRgb(0, 0, 2), 1],
        ]);
    });

    it("the spawn going away clears its text decorations and scrollbar marks in the editors", async () => {
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
        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [{ range: span(4, 0, 2) }] });
        await flushMicrotasks(10);
        expect(h.textFor("/a.ts").map((d) => d.range)).toStrictEqual([span(4, 0, 2)]);

        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [] });
        await flushMicrotasks(10);
        expect(h.textFor("/a.ts")).toStrictEqual([]);

        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [{ range: span(4, 0, 2) }] });
        h.peer.notify("window.disposeTextEditorDecorationType", { key: 1 });
        await flushMicrotasks(10);
        expect(h.textFor("/a.ts")).toStrictEqual([]);
    });
});

/** The type Tailwind CSS IntelliSense 0.16 creates for its color squares. */
// Tailwind's own box: the width is a swatch's, the margin rounds to no cell.
const TAILWIND_TYPE = {
    before: { contentText: " ", width: "0.8em", margin: "0.1em 0.2em 0" },
    dark: { before: { borderColor: "#eeeeee" } },
    light: { before: { borderColor: "#000000" } },
};
const RED_500 = packRgba(239, 68, 68, 255);

describe("DecorationsCustomer — text attributes and opacity", () => {
    async function typed(options: unknown) {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", { key: 1, options });
        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [{ range: span(0, 5, 8) }] });
        await flushMicrotasks(10);
        return h;
    }
    const styleOf = async (options: unknown) => (await typed(options)).textFor("/a.ts")[0]?.style;
    const opacityOf = async (options: unknown) => (await typed(options)).textFor("/a.ts")[0]?.opacity;

    it("[api:window.createTextEditorDecorationType] clangd's inactive region: a whole-line opacity fades the text", async () => {
        const h = await typed({ isWholeLine: true, opacity: "0.55" });
        expect(h.textFor("/a.ts")).toStrictEqual([{ range: span(0, 5, 8), opacity: 0.55, isWholeLine: true }]);
    });

    it("opacity is a CSS alpha value: a number or a percentage, clamped; opaque and garbage are none", async () => {
        expect(await opacityOf({ opacity: "55%" })).toBe(0.55);
        expect(await opacityOf({ opacity: " 0.3 " })).toBe(0.3);
        expect(await opacityOf({ opacity: "-1" })).toBe(0);
        expect(await opacityOf({ opacity: "0" })).toBe(0);
        expect(await opacityOf({ opacity: "1" })).toBeUndefined();
        expect(await opacityOf({ opacity: "150%" })).toBeUndefined();
        expect(await opacityOf({ opacity: "half" })).toBeUndefined();
        expect(await opacityOf({ opacity: "" })).toBeUndefined();
        expect(await opacityOf({ opacity: ".5" })).toBe(0.5);
        expect(await opacityOf({ opacity: "5e-1" })).toBe(0.5);
        expect(await opacityOf({ opacity: "%" })).toBeUndefined();
        expect(await opacityOf({ opacity: "0x0" })).toBeUndefined();
        expect(await opacityOf({ opacity: "0.5 !important" })).toBeUndefined();
        expect(await opacityOf({ opacity: 0.5 })).toBeUndefined();
    });

    it("[api:window.createTextEditorDecorationType] Markdown's strikethrough: line-through becomes the cell attribute", async () => {
        const h = await typed({ rangeBehavior: 1, textDecoration: "line-through" });
        expect(h.textFor("/a.ts")).toStrictEqual([
            { range: span(0, 5, 8), style: StyleFlags.Strikethrough, isWholeLine: false, stickiness: 1 },
        ]);
    });

    it("textDecoration keeps the lines a cell has: underline (wavy — a curl) and line-through; the rest is none", async () => {
        expect(await styleOf({ textDecoration: "underline" })).toBe(StyleFlags.Underline);
        expect(await styleOf({ textDecoration: "underline wavy red" })).toBe(StyleFlags.Undercurl);
        expect(await styleOf({ textDecoration: "  line-through  " })).toBe(StyleFlags.Strikethrough);
        expect(await styleOf({ textDecoration: "Line-Through  Underline" })).toBe(
            StyleFlags.Strikethrough | StyleFlags.Underline,
        );
        // CSS smuggled after `;` is dropped with the rest of the declaration.
        expect(await styleOf({ textDecoration: "none; display: none" })).toBeUndefined();
        expect(await styleOf({ textDecoration: "underline; font-size: 0" })).toBe(StyleFlags.Underline);
        expect(await styleOf({ textDecoration: "overline" })).toBeUndefined();
        expect(await styleOf({ textDecoration: "wavy" })).toBeUndefined();
        expect(await styleOf({ textDecoration: 4 })).toBeUndefined();
    });

    it("fontWeight is bold from 600 and for bold/bolder; fontStyle italic and oblique lean", async () => {
        for (const weight of ["bold", "bolder", "600", " 900 ", " bold "])
            expect(await styleOf({ fontWeight: weight })).toBe(StyleFlags.Bold);
        for (const weight of ["normal", "lighter", "599", "", "heavy", "100px"])
            expect(await styleOf({ fontWeight: weight })).toBeUndefined();
        expect(await styleOf({ fontStyle: "italic" })).toBe(StyleFlags.Italic);
        expect(await styleOf({ fontStyle: "oblique" })).toBe(StyleFlags.Italic);
        expect(await styleOf({ fontStyle: "normal" })).toBeUndefined();
        expect(await styleOf({ fontStyle: "slanted" })).toBeUndefined();
        expect(await styleOf({ fontStyle: "italic", fontWeight: "700", textDecoration: "underline" })).toBe(
            StyleFlags.Italic | StyleFlags.Bold | StyleFlags.Underline,
        );
    });

    it("a branch's normal clears the base's weight and style; a branch's garbage is no value and leaves the base", async () => {
        const base = { fontWeight: "bold", fontStyle: "italic" };
        expect(await styleOf({ ...base, dark: { fontWeight: "normal", fontStyle: "normal" } })).toBeUndefined();
        expect(await styleOf({ ...base, dark: { fontWeight: "lighter" } })).toBe(StyleFlags.Italic);
        for (const garbage of ["", "heavy", "100px"])
            expect(await styleOf({ ...base, dark: { fontWeight: garbage, fontStyle: garbage } })).toBe(
                StyleFlags.Bold | StyleFlags.Italic,
            );
        expect(await opacityOf({ opacity: "0.5", dark: { opacity: "half" } })).toBe(0.5);
        expect(await styleOf({ textDecoration: "underline", dark: { textDecoration: "none" } })).toBeUndefined();
    });

    it("the branch of the current theme wins property by property; a theme change resends the attributes", async () => {
        const h = await typed({
            fontWeight: "bold",
            fontStyle: "italic",
            opacity: "0.5",
            light: { fontWeight: "normal", textDecoration: "underline" },
            dark: { opacity: "0.25", fontStyle: "garbage" },
        });
        expect(h.textFor("/a.ts")).toStrictEqual([
            {
                range: span(0, 5, 8),
                style: StyleFlags.Bold | StyleFlags.Italic,
                opacity: 0.25,
                isWholeLine: false,
            },
        ]);

        h.changeTheme(ColorThemeKind.Light);
        expect(h.textFor("/a.ts")).toStrictEqual([
            {
                range: span(0, 5, 8),
                style: StyleFlags.Italic | StyleFlags.Underline,
                opacity: 0.5,
                isWholeLine: false,
            },
        ]);
    });
});

describe("DecorationsCustomer — hoverMessage", () => {
    it("[api:DecorationOptions.hoverMessage] each range carries its own hoverMessage, also on a type that draws nothing", async () => {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", { key: 1, options: {} });
        h.peer.notify("editor.setDecorations", {
            key: 1,
            uri: A_TS,
            ranges: [
                { range: span(0, 1, 2), hoverMessage: ["**a**"] },
                { range: span(1, 1, 2) },
                { range: span(2, 0, 9), renderOptions: { after: { contentText: "blame" } }, hoverMessage: ["c", "d"] },
            ],
        });
        await flushMicrotasks(10);
        expect(h.textCalls.at(-1)?.set.decorations).toStrictEqual([
            { range: span(0, 1, 2), isWholeLine: false, hoverMessage: ["**a**"] },
            { range: span(1, 1, 2), isWholeLine: false },
            {
                range: span(2, 0, 9),
                isWholeLine: false,
                after: { kind: "text", text: "blame", style: StyleFlags.None },
                hoverMessage: ["c", "d"],
            },
        ]);
    });

    it("a theme change restyles the ranges and keeps their hoverMessage", async () => {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", { key: 1, options: {} });
        h.peer.notify("editor.setDecorations", {
            key: 1,
            uri: A_TS,
            ranges: [{ range: span(0, 1, 2), hoverMessage: ["m"] }],
        });
        await flushMicrotasks(10);
        h.changeTheme(ColorThemeKind.Light);
        expect(h.textCalls.at(-1)?.set).toStrictEqual({
            key: 1,
            restyle: true,
            decorations: [{ range: span(0, 1, 2), isWholeLine: false, hoverMessage: ["m"] }],
        });
    });
});

describe("DecorationsCustomer — before/after attachments", () => {
    async function withRanges(options: unknown, ranges: unknown[]) {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", { key: 1, options });
        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges });
        await flushMicrotasks(10);
        return h;
    }

    it("[api:TextEditor.setDecorations] a blank contentText with a range background is a swatch of that color (Tailwind)", async () => {
        const h = await withRanges(TAILWIND_TYPE, [
            {
                range: span(0, 7, 17),
                renderOptions: { before: { backgroundColor: "rgba(239.00000000000003, 68, 68, 1)" } },
            },
        ]);
        expect(h.textFor("/a.ts")).toStrictEqual([
            { range: span(0, 7, 17), isWholeLine: false, before: { kind: "swatch", color: RED_500 } },
        ]);
    });

    it("[api:window.createTextEditorDecorationType] a swatch takes backgroundColor, else borderColor of the theme branch, else color", async () => {
        const h = await withRanges(TAILWIND_TYPE, [{ range: span(0, 1, 2) }]);
        expect(h.textFor("/a.ts")[0].before).toStrictEqual({ kind: "swatch", color: packRgb(0xee, 0xee, 0xee) });
        h.changeTheme(ColorThemeKind.Light);
        expect(h.textFor("/a.ts")[0].before).toStrictEqual({ kind: "swatch", color: packRgb(0, 0, 0) });

        const colorOnly = await withRanges({ after: { color: "blue", borderColor: "#ggg" } }, [
            { range: span(0, 1, 2) },
        ]);
        expect(colorOnly.textFor("/a.ts")[0].after).toStrictEqual({ kind: "swatch", color: packRgb(0, 0, 255) });
    });

    it("no text and no color — nothing is drawn, also with a blank contentText or an unparsable color", async () => {
        const h = await withRanges({ before: { contentText: " \t " }, after: {} }, [
            { range: span(0, 1, 2) },
            { range: span(1, 1, 2), renderOptions: { before: { backgroundColor: "rgba(1,2)" } } },
        ]);
        expect(h.textFor("/a.ts")).toStrictEqual([]);
        expect(h.rpcLogger.warn).not.toHaveBeenCalled();
    });

    it("[api:window.createTextEditorDecorationType] text takes its color, background and italic; without them it has none", async () => {
        const h = await withRanges(
            {
                after: {
                    contentText: "  You, 2 days ago",
                    color: "#808080",
                    backgroundColor: "#102030",
                    fontStyle: "italic",
                },
                before: { contentText: "⚠ ", fontStyle: "oblique" },
            },
            [{ range: span(2, 0, 4) }],
        );
        expect(h.textFor("/a.ts")).toStrictEqual([
            {
                range: span(2, 0, 4),
                isWholeLine: false,
                before: { kind: "text", text: "⚠ ", style: StyleFlags.Italic },
                after: {
                    kind: "text",
                    text: "  You, 2 days ago",
                    fg: packRgb(0x80, 0x80, 0x80),
                    bg: packRgb(0x10, 0x20, 0x30),
                    style: StyleFlags.Italic,
                },
            },
        ]);
    });

    it("contentText keeps its first line only, a tab becomes a space, control characters go", async () => {
        const h = await withRanges({ after: { contentText: "a\tb\u0007c\u009b\u007f\nsecond" } }, [
            { range: span(0, 0, 1) },
        ]);
        expect(h.textFor("/a.ts")[0].after).toStrictEqual({ kind: "text", text: "a bc", style: StyleFlags.None });
        const cr = await withRanges({ after: { contentText: "one\rtwo" } }, [{ range: span(0, 0, 1) }]);
        expect(cr.textFor("/a.ts")[0].after).toStrictEqual({ kind: "text", text: "one", style: StyleFlags.None });
    });

    it("[api:TextEditor.setDecorations] type ⊕ type branch ⊕ range ⊕ range branch, a later layer wins field by field", async () => {
        const h = await withRanges(
            {
                after: { contentText: "type", color: "#000001", fontStyle: "italic" },
                dark: { after: { color: "#000002", backgroundColor: "#000003" } },
            },
            [
                {
                    range: span(0, 0, 1),
                    renderOptions: {
                        after: { contentText: "range", backgroundColor: "#000004" },
                        dark: { after: { fontStyle: "normal" } },
                        light: { after: { color: "#000005" } },
                    },
                },
                { range: span(1, 0, 1) },
            ],
        );
        expect(h.textFor("/a.ts").map((d) => d.after)).toStrictEqual([
            { kind: "text", text: "range", fg: packRgb(0, 0, 2), bg: packRgb(0, 0, 4), style: StyleFlags.None },
            { kind: "text", text: "type", fg: packRgb(0, 0, 2), bg: packRgb(0, 0, 3), style: StyleFlags.Italic },
        ]);

        h.changeTheme(ColorThemeKind.Light);
        expect(h.textFor("/a.ts").map((d) => d.after)).toStrictEqual([
            { kind: "text", text: "range", fg: packRgb(0, 0, 5), bg: packRgb(0, 0, 4), style: StyleFlags.Italic },
            { kind: "text", text: "type", fg: packRgb(0, 0, 1), style: StyleFlags.Italic },
        ]);
    });

    it("a ThemeColor in an attachment resolves through the theme, an unknown one is no color", async () => {
        const h = await withRanges({ after: { contentText: "x", color: { $themeColor: "editor.foreground" } } }, [
            { range: span(0, 0, 1), renderOptions: { before: { backgroundColor: { $themeColor: "no.such" } } } },
        ]);
        expect(h.textFor("/a.ts")).toStrictEqual([
            {
                range: span(0, 0, 1),
                isWholeLine: false,
                after: { kind: "text", text: "x", fg: FG, style: StyleFlags.None },
            },
        ]);
    });

    it("garbage renderOptions are no layer, the type's own attachments live on", async () => {
        const h = await withRanges({ before: { contentText: "t" } }, [
            { range: span(0, 0, 1), renderOptions: { before: "red", after: 5, light: "x", dark: null } },
            { range: span(1, 0, 1), renderOptions: { before: null, dark: { before: null } } },
        ]);
        expect(h.textFor("/a.ts")).toStrictEqual([
            { range: span(0, 0, 1), isWholeLine: false, before: { kind: "text", text: "t", style: StyleFlags.None } },
            { range: span(1, 0, 1), isWholeLine: false, before: { kind: "text", text: "t", style: StyleFlags.None } },
        ]);
    });

    it("an unparsable color of a range leaves the earlier layer's colors, as an invalid CSS value does", async () => {
        const h = await withRanges(TAILWIND_TYPE, [
            {
                range: span(0, 1, 2),
                renderOptions: { before: { backgroundColor: "rgba(1,2)", borderColor: "#ggg", color: 5 } },
            },
        ]);
        expect(h.textFor("/a.ts")[0].before).toStrictEqual({ kind: "swatch", color: packRgb(0xee, 0xee, 0xee) });
    });

    /** The `after` of a type with this `after` layer, on one range. */
    async function afterOf(after: Record<string, unknown>, renderOptions?: unknown) {
        const h = await withRanges({ after: { contentText: "msg", ...after } }, [
            { range: span(0, 0, 1), ...(renderOptions === undefined ? {} : { renderOptions }) },
        ]);
        return h.textFor("/a.ts")[0].after;
    }

    async function marginOf(margin: string) {
        const after = await afterOf({ margin });
        return after === undefined ? undefined : { left: after.marginLeft, right: after.marginRight };
    }

    it("[api:window.createTextEditorDecorationType] Error Lens defaults: a 4ch left margin, a normal weight, CSS injected after `;` dropped", async () => {
        const after = await afterOf({
            contentText: "Missing ';'",
            color: "#ff0000",
            fontStyle: "normal",
            fontWeight: "normal",
            textDecoration: "none;font-family:monospace",
            margin: "0 0 0 4ch",
        });
        expect(after).toStrictEqual({
            kind: "text",
            text: "Missing ';'",
            fg: packRgb(0xff, 0, 0),
            style: StyleFlags.None,
            marginLeft: 4,
        });
    });

    it("[api:window.createTextEditorDecorationType] the margin shorthand: 1 value — all sides, 2 — (vertical, horizontal), 3 — (top, horizontal, bottom), 4 — (top, right, bottom, left)", async () => {
        expect(await marginOf("1ch")).toStrictEqual({ left: 1, right: 1 });
        expect(await marginOf("9ch 2ch")).toStrictEqual({ left: 2, right: 2 });
        expect(await marginOf("9ch 3ch 9ch")).toStrictEqual({ left: 3, right: 3 });
        // GitLens's file blame.
        expect(await marginOf("0 26px -1px 0")).toStrictEqual({ left: undefined, right: 3 });
        expect(await marginOf("  0\t1ch  0 2ch ")).toStrictEqual({ left: 2, right: 1 });
        // Whitespace inside calc() doesn't split, and the values after it are split again.
        expect(await marginOf("0 calc(1ch + 2ch) 0 1ch")).toStrictEqual({ left: 1, right: 3 });
    });

    it("lengths become cells: ch as is, em and rem twice, 8 px a cell, calc() by its ch addends; the rest and negatives are none", async () => {
        expect(await marginOf("0 0 0 3em")).toStrictEqual({ left: 6, right: undefined });
        expect(await marginOf("0 0 0 2rem")).toStrictEqual({ left: 4, right: undefined });
        expect(await marginOf("0 0 0 2REM")).toStrictEqual({ left: 4, right: undefined });
        expect(await marginOf("0 0 0 1.4ch")).toStrictEqual({ left: 1, right: undefined });
        expect(await marginOf("0 0 0 0.75em")).toStrictEqual({ left: 2, right: undefined });
        expect(await marginOf("0 0 0 12px")).toStrictEqual({ left: 2, right: undefined });
        expect(await marginOf("0 0 0 calc(5ch - 6px)")).toStrictEqual({ left: 5, right: undefined });
        expect(await marginOf("0 0 0 calc(5ch - 2ch + 1ch)")).toStrictEqual({ left: 4, right: undefined });
        expect(await marginOf("0 0 0 calc(2em + 6px)")).toStrictEqual({ left: undefined, right: undefined });
        expect(await marginOf("0 0 0 -2ch")).toStrictEqual({ left: undefined, right: undefined });
        for (const garbage of ["0 0 0 auto", "0 0 0 4", "0 0 0 4vw", "0 0 0 4chx", "0 0 0 x4ch"]) {
            expect(await marginOf(garbage), garbage).toStrictEqual({ left: undefined, right: undefined });
        }
    });

    it("a margin of no value or of more than 4 leaves the earlier layer's, a range's own margin replaces the type's whole", async () => {
        const spaces = await afterOf({ margin: "0 2ch" }, { after: { margin: "  " } });
        expect([spaces?.marginLeft, spaces?.marginRight]).toStrictEqual([2, 2]);
        const five = await afterOf({ margin: "0 2ch" }, { after: { margin: "1ch 1ch 1ch 1ch 1ch" } });
        expect([five?.marginLeft, five?.marginRight]).toStrictEqual([2, 2]);
        const replaced = await afterOf({ margin: "0 2ch" }, { after: { margin: "0 0 0 1ch" } });
        expect([replaced?.marginLeft, replaced?.marginRight]).toStrictEqual([1, undefined]);
    });

    it("[api:window.createTextEditorDecorationType] width fits the text: a short one is padded with spaces, a long one cut, wide glyphs whole", async () => {
        const text = async (contentText: string, width: unknown) =>
            (await afterOf({ contentText, width })) as { text: string } | undefined;
        expect((await text("ab", "calc(6ch - 6px)"))?.text).toBe("ab    ");
        expect((await text("abcdef", "3ch"))?.text).toBe("abc");
        expect((await text("abc", "3ch"))?.text).toBe("abc");
        expect((await text("日本", "3ch"))?.text).toBe("日 ");
        for (const none of ["1px", "auto", 5]) expect((await text("abcdef", none))?.text, String(none)).toBe("abcdef");
    });

    it("a width of no cell leaves the earlier layer's", async () => {
        const after = await afterOf({ contentText: "abcdef", width: "2ch" }, { after: { width: "0" } });
        expect(after).toMatchObject({ text: "ab" });
    });

    it("[api:window.createTextEditorDecorationType] fontWeight and textDecoration of an attachment are cell attributes, a branch's normal clears the base's", async () => {
        expect(await afterOf({ fontWeight: "bold", textDecoration: "underline", fontStyle: "italic" })).toMatchObject({
            style: StyleFlags.Bold | StyleFlags.Underline | StyleFlags.Italic,
        });
        expect(await afterOf({ fontWeight: "600", textDecoration: "wavy underline line-through" })).toMatchObject({
            style: StyleFlags.Bold | StyleFlags.Undercurl | StyleFlags.Strikethrough,
        });
        expect(await afterOf({ fontWeight: "500", textDecoration: "overline" })).toMatchObject({
            style: StyleFlags.None,
        });
        const cleared = await afterOf(
            { fontWeight: "bold", textDecoration: "underline" },
            { dark: { after: { fontWeight: "normal", textDecoration: "none" } } },
        );
        expect(cleared).toMatchObject({ style: StyleFlags.None });
        const kept = await afterOf(
            { fontWeight: "bold", textDecoration: "underline" },
            { after: { fontWeight: "heavy", textDecoration: 5 } },
        );
        expect(kept).toMatchObject({ style: StyleFlags.Bold | StyleFlags.Underline });
    });

    it("borders and outlines draw nothing and break nothing; a swatch takes the margin too", async () => {
        expect(await afterOf({ border: "1px solid red", outline: "1px solid red", borderRadius: "2px" })).toStrictEqual(
            {
                kind: "text",
                text: "msg",
                style: StyleFlags.None,
            },
        );
        const swatch = await withRanges({ before: { contentText: "", color: "#00ff00", margin: "0 1ch 0 2ch" } }, [
            { range: span(0, 0, 1) },
        ]);
        expect(swatch.textFor("/a.ts")[0].before).toStrictEqual({
            kind: "swatch",
            color: packRgb(0, 0xff, 0),
            marginLeft: 2,
            marginRight: 1,
        });
    });

    it("[api:window.createTextEditorDecorationType] rangeBehavior becomes the tracked stickiness; an unknown value is the default", async () => {
        for (const rangeBehavior of [0, 1, 2, 3]) {
            const h = await withRanges({ rangeBehavior, before: { contentText: "t" } }, [{ range: span(0, 0, 1) }]);
            expect(h.textFor("/a.ts")[0].stickiness).toBe(rangeBehavior);
        }
        for (const rangeBehavior of [-1, 4, "1", 1.5]) {
            const h = await withRanges({ rangeBehavior, before: { contentText: "t" } }, [{ range: span(0, 0, 1) }]);
            expect(h.textFor("/a.ts")[0]).not.toHaveProperty("stickiness");
        }
    });

    it("every range of the type goes in each set, a theme change resends them as a restyle", async () => {
        const h = await withRanges({ before: { contentText: "t" } }, [{ range: span(0, 0, 1) }]);
        expect(h.textCalls.at(-1)?.set).toStrictEqual({
            key: 1,
            decorations: [
                {
                    range: span(0, 0, 1),
                    isWholeLine: false,
                    before: { kind: "text", text: "t", style: StyleFlags.None },
                },
            ],
        });
        h.changeTheme(ColorThemeKind.Light);
        expect(h.textCalls.at(-1)?.set.restyle).toBe(true);
        expect(h.textCalls.at(-1)?.set.decorations).toHaveLength(1);

        // A type that draws nothing in this theme still sends its ranges: the restyle keeps them by index.
        const nothing = await withRanges({ light: { before: { contentText: "t" } } }, [{ range: span(0, 0, 1) }]);
        expect(nothing.textCalls.at(-1)?.set.decorations).toStrictEqual([{ range: span(0, 0, 1), isWholeLine: false }]);
    });

    it("disposing a type sends an empty set of that type only, in each file it was in", async () => {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", { key: 1, options: { before: { contentText: "a" } } });
        h.peer.notify("window.createTextEditorDecorationType", { key: 2, options: { before: { contentText: "b" } } });
        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [{ range: span(0, 0, 1) }] });
        h.peer.notify("editor.setDecorations", { key: 2, uri: A_TS, ranges: [{ range: span(1, 0, 1) }] });
        await flushMicrotasks(10);
        const before = h.textCalls.length;

        h.peer.notify("window.disposeTextEditorDecorationType", { key: 1 });
        await flushMicrotasks(10);

        expect(h.textCalls.slice(before)).toStrictEqual([{ uri: A_TS, set: { key: 1, decorations: [] } }]);
        expect(h.textFor("/a.ts").map((d) => d.range.start.line)).toStrictEqual([1]);
    });
});

describe("DecorationsCustomer — gutter icons", () => {
    const RED_DOT = `<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" fill="#e51400"/></svg>`;
    const BLUE_BAR = `<svg xmlns='http://www.w3.org/2000/svg'><rect fill='rgb(0,0,255)' x='13' y='0' width='3' height='18'/></svg>`;
    const RED = packRgba(0xe5, 0x14, 0x00, 255);
    const dataUri = (svg: string) => Uri.parse(`data:image/svg+xml,${encodeURIComponent(svg)}`).toString();
    const files = new Map([["/icons/dark.svg", RED_DOT]]);

    function iconSetup() {
        const reads: string[] = [];
        const h = setup(COLORS, (resource) => {
            reads.push(resource.path);
            const content = files.get(resource.path);
            return content === undefined
                ? Promise.reject(new Error("ENOENT"))
                : Promise.resolve(new TextEncoder().encode(content));
        });
        return { ...h, reads };
    }

    it("[api:ThemableDecorationRenderOptions.gutterIconPath] a file icon puts one glyph of its color on every line of each range, after one read", async () => {
        const h = iconSetup();
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 7,
            options: { gutterIconPath: Uri.file("/icons/dark.svg").toString() },
        });
        const twoLines = { start: { line: 4, character: 2 }, end: { line: 5, character: 0 } };
        h.peer.notify("editor.setDecorations", {
            key: 7,
            uri: A_TS,
            ranges: [{ range: span(1, 0, 3) }, { range: twoLines }, { range: span(1, 4, 5) }],
        });
        const B_TS = Uri.file("/b.ts").toString();
        h.peer.notify("editor.setDecorations", { key: 7, uri: B_TS, ranges: [{ range: range(0) }] });
        await flushMicrotasks(10);

        const glyph = (line: number) => ({
            key: String(line),
            line,
            glyph: "●",
            colorToken: "editorLineNumber.foreground",
            color: RED,
        });
        expect(h.glyphsFor("/a.ts", "ext:7")).toStrictEqual([glyph(1), glyph(4), glyph(5)]);
        expect(h.glyphsFor("/b.ts", "ext:7")).toStrictEqual([glyph(0)]);
        expect(h.reads).toEqual(["/icons/dark.svg"]);
    });

    it("[api:ThemableDecorationRenderOptions.gutterIconPath] a data: URI needs no read; the theme branch picks the icon", async () => {
        const h = iconSetup();
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 1,
            options: { gutterIconPath: dataUri(BLUE_BAR), dark: { gutterIconPath: dataUri(RED_DOT) } },
        });
        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [{ range: range(2) }] });
        await flushMicrotasks(10);
        expect(h.glyphsFor("/a.ts", "ext:1")?.map((g) => [g.glyph, g.color])).toEqual([["●", RED]]);

        h.changeTheme(ColorThemeKind.Light);
        await flushMicrotasks(10);
        expect(h.glyphsFor("/a.ts", "ext:1")?.map((g) => [g.glyph, g.color])).toEqual([
            ["▎", packRgba(0, 0, 255, 255)],
        ]);
        expect(h.reads).toEqual([]);
    });

    it("an unreadable icon is a dot in the gutter's color, not an error", async () => {
        const h = iconSetup();
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 1,
            options: { gutterIconPath: Uri.file("/icons/missing.svg").toString() },
        });
        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [{ range: range(0) }] });
        await flushMicrotasks(10);

        expect(h.glyphsFor("/a.ts", "ext:1")).toStrictEqual([
            { key: "0", line: 0, glyph: "●", colorToken: "editorLineNumber.foreground" },
        ]);
        expect(h.rpcLogger.warn).not.toHaveBeenCalled();
    });

    it("without a file reader a file icon is a dot in the gutter's color", async () => {
        const h = setup();
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 1,
            options: { gutterIconPath: Uri.file("/icons/dark.svg").toString() },
        });
        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [{ range: range(0) }] });
        await flushMicrotasks(10);

        expect(h.glyphsFor("/a.ts", "ext:1")?.map((g) => [g.glyph, g.color])).toEqual([["●", undefined]]);
    });

    it("a type without an icon never touches the glyph lane; disposing an icon type clears its glyphs", async () => {
        const h = iconSetup();
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 1,
            options: { backgroundColor: "red", gutterIconPath: 42 },
        });
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 2,
            options: { light: { gutterIconPath: dataUri(RED_DOT) } },
        });
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 3,
            options: { dark: { gutterIconPath: dataUri(RED_DOT) } },
        });
        h.peer.notify("editor.setDecorations", { key: 1, uri: A_TS, ranges: [{ range: range(0) }] });
        h.peer.notify("editor.setDecorations", { key: 2, uri: A_TS, ranges: [{ range: range(1) }] });
        await flushMicrotasks(10);
        // The dark theme has no icon for the type: nothing to draw, but the layer is the type's.
        expect(h.glyphCalls.map((c) => c.owner)).toEqual(["ext:2"]);
        expect(h.glyphsFor("/a.ts", "ext:2")).toStrictEqual([]);

        // An icon of the dark branch only is an icon all the same.
        h.peer.notify("editor.setDecorations", { key: 3, uri: A_TS, ranges: [{ range: range(2) }] });
        await flushMicrotasks(10);
        expect(h.glyphsFor("/a.ts", "ext:3")?.map((g) => g.line)).toEqual([2]);
        h.peer.notify("window.disposeTextEditorDecorationType", { key: 3 });
        await flushMicrotasks(10);
        expect(h.glyphsFor("/a.ts", "ext:3")).toStrictEqual([]);

        h.changeTheme(ColorThemeKind.Light);
        await flushMicrotasks(10);
        expect(h.glyphsFor("/a.ts", "ext:2")).toHaveLength(1);

        h.peer.notify("window.disposeTextEditorDecorationType", { key: 1 });
        h.peer.notify("window.disposeTextEditorDecorationType", { key: 2 });
        await flushMicrotasks(10);
        expect(h.glyphCalls.every((c) => c.owner !== "ext:1")).toBe(true);
        expect(h.glyphsFor("/a.ts", "ext:2")).toStrictEqual([]);
    });

    it("an icon read finishing redraws only the types showing that icon", async () => {
        let finishRead: (content: Uint8Array) => void = () => undefined;
        const h = setup(
            COLORS,
            () =>
                new Promise((resolve) => {
                    finishRead = resolve;
                }),
        );
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 1,
            options: { gutterIconPath: dataUri(RED_DOT) },
        });
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 2,
            options: { gutterIconPath: Uri.file("/slow.svg").toString() },
        });
        // Ranges of a key the spawn never created sit among them and draw nothing.
        for (const key of [9, 1, 2])
            h.peer.notify("editor.setDecorations", { key, uri: A_TS, ranges: [{ range: range(key % 9) }] });
        await flushMicrotasks(10);
        const before = h.glyphCalls.length;

        finishRead(new TextEncoder().encode(RED_DOT));
        await flushMicrotasks(10);
        expect(h.glyphCalls.slice(before).map((c) => c.owner)).toEqual(["ext:2"]);
        expect(h.glyphsFor("/a.ts", "ext:2")?.map((g) => [g.line, g.glyph])).toEqual([[2, "●"]]);
    });

    it("the spawn going away clears its glyphs, and an icon read finishing after that draws none back", async () => {
        let finishRead: (content: Uint8Array) => void = () => undefined;
        const h = setup(
            COLORS,
            () =>
                new Promise((resolve) => {
                    finishRead = resolve;
                }),
        );
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 1,
            options: { gutterIconPath: dataUri(RED_DOT) },
        });
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 2,
            options: { gutterIconPath: Uri.file("/slow.svg").toString() },
        });
        h.peer.notify("window.createTextEditorDecorationType", { key: 3, options: { backgroundColor: "red" } });
        // Ranges for a key the spawn never created come first: clearing them must not stop the others.
        h.peer.notify("editor.setDecorations", { key: 9, uri: A_TS, ranges: [{ range: range(0) }] });
        for (const key of [1, 2, 3])
            h.peer.notify("editor.setDecorations", { key, uri: A_TS, ranges: [{ range: range(key) }] });
        await flushMicrotasks(10);
        expect(h.glyphsFor("/a.ts", "ext:1")).toHaveLength(1);
        expect(h.glyphsFor("/a.ts", "ext:2")).toStrictEqual([]);
        const before = h.glyphCalls.length;

        h.attached.dispose();
        expect(h.glyphCalls.slice(before).map((c) => [c.owner, c.decorations])).toEqual([
            ["ext:1", []],
            ["ext:2", []],
        ]);

        finishRead(new TextEncoder().encode(RED_DOT));
        await flushMicrotasks(10);
        expect(h.glyphCalls).toHaveLength(before + 2);
    });
});
