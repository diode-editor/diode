import { packRgb, packRgba, TRANSPARENT_COLOR } from "@tuidom/core/common/colorUtils";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type {
    IExtensionTextDecoration,
    IExtensionTextDecorationSet,
} from "../../../../../editor/common/model/iExtensionTextDecoration.ts";
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
    const textCalls: { uri: string; set: IExtensionTextDecorationSet }[] = [];
    const fileCalls: { path: string; color?: number; badge?: string }[][] = [];
    const themeListeners: (() => void)[] = [];
    let kind = ColorThemeKind.Dark;
    const customer = new DecorationsCustomer(
        {
            setGutterChangeDecorations: (uri, decorations) => editorCalls.push({ uri, decorations }),
            setExtensionTextDecorations: (uri, set) => textCalls.push({ uri, set }),
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
                        d.after !== undefined,
                );
        },
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
            h.peer.notify("editor.setDecorations", { key, uri, ranges: [{ range: range(key) }] });
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
        h.peer.notify("editor.setDecorations", { key: 1, uri, ranges: [{ range: range(2) }] });
        h.peer.notify("editor.setDecorations", { key: 2, uri, ranges: [{ range: range(5) }] });
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
const TAILWIND_TYPE = {
    before: { contentText: " " },
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
        for (const weight of ["bold", "bolder", "600", " 900 "])
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
                before: { kind: "text", text: "⚠ ", italic: true },
                after: {
                    kind: "text",
                    text: "  You, 2 days ago",
                    fg: packRgb(0x80, 0x80, 0x80),
                    bg: packRgb(0x10, 0x20, 0x30),
                    italic: true,
                },
            },
        ]);
    });

    it("contentText keeps its first line only, a tab becomes a space, control characters go", async () => {
        const h = await withRanges({ after: { contentText: "a\tb\u0007c\u009b\u007f\nsecond" } }, [
            { range: span(0, 0, 1) },
        ]);
        expect(h.textFor("/a.ts")[0].after).toStrictEqual({ kind: "text", text: "a bc", italic: false });
        const cr = await withRanges({ after: { contentText: "one\rtwo" } }, [{ range: span(0, 0, 1) }]);
        expect(cr.textFor("/a.ts")[0].after).toStrictEqual({ kind: "text", text: "one", italic: false });
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
            { kind: "text", text: "range", fg: packRgb(0, 0, 2), bg: packRgb(0, 0, 4), italic: false },
            { kind: "text", text: "type", fg: packRgb(0, 0, 2), bg: packRgb(0, 0, 3), italic: true },
        ]);

        h.changeTheme(ColorThemeKind.Light);
        expect(h.textFor("/a.ts").map((d) => d.after)).toStrictEqual([
            { kind: "text", text: "range", fg: packRgb(0, 0, 5), bg: packRgb(0, 0, 4), italic: true },
            { kind: "text", text: "type", fg: packRgb(0, 0, 1), italic: true },
        ]);
    });

    it("a ThemeColor in an attachment resolves through the theme, an unknown one is no color", async () => {
        const h = await withRanges({ after: { contentText: "x", color: { $themeColor: "editor.foreground" } } }, [
            { range: span(0, 0, 1), renderOptions: { before: { backgroundColor: { $themeColor: "no.such" } } } },
        ]);
        expect(h.textFor("/a.ts")).toStrictEqual([
            { range: span(0, 0, 1), isWholeLine: false, after: { kind: "text", text: "x", fg: FG, italic: false } },
        ]);
    });

    it("garbage renderOptions are no layer, the type's own attachments live on", async () => {
        const h = await withRanges({ before: { contentText: "t" } }, [
            { range: span(0, 0, 1), renderOptions: { before: "red", after: 5, light: "x", dark: null } },
            { range: span(1, 0, 1), renderOptions: { before: null, dark: { before: null } } },
        ]);
        expect(h.textFor("/a.ts")).toStrictEqual([
            { range: span(0, 0, 1), isWholeLine: false, before: { kind: "text", text: "t", italic: false } },
            { range: span(1, 0, 1), isWholeLine: false, before: { kind: "text", text: "t", italic: false } },
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
                { range: span(0, 0, 1), isWholeLine: false, before: { kind: "text", text: "t", italic: false } },
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
