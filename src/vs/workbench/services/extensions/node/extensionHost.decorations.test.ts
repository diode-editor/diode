import { packRgba } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { IGlyphMarginDecoration } from "../../../../editor/common/model/iGlyphMarginDecoration.ts";
import type { IOverviewRulerDecoration } from "../../../../editor/common/model/iOverviewRulerDecoration.ts";
import {
    type IEditorDecorationsService,
    NULL_EDITOR_DECORATIONS_SERVICE,
} from "../../../api/common/iEditorDecorationsService.ts";
import type { IFileDecorationsService } from "../../../api/common/iFileDecorationsService.ts";
import type { IThemeColorResolver } from "../../../api/common/iThemeColorResolver.ts";
import { ColorThemeKind } from "../../../api/common/vscodeTypes.ts";

// packed-RGB
const MODIFIED_GUTTER = 0x1b81a8;
const MODIFIED_GUTTER_LIGHT = 0x2090d3;
const MODIFIED_FILE = 0xe2c08d;
const MODIFIED_FILE_LIGHT = 0x895503;

function makeControllableResolver(initial: Record<string, number>): {
    resolver: IThemeColorResolver;
    recolor: (next: Record<string, number>) => void;
} {
    let colors = { ...initial };
    const listeners: (() => void)[] = [];
    const resolver: IThemeColorResolver = {
        resolve: (id) => colors[id],
        kind: () => ColorThemeKind.Dark,
        onDidChange: (cb) => {
            listeners.push(cb);
            return {
                dispose: () => {
                    const i = listeners.indexOf(cb);
                    if (i >= 0) listeners.splice(i, 1);
                },
            };
        },
    };
    return {
        resolver,
        recolor: (next) => {
            colors = { ...next };
            for (const cb of [...listeners]) cb();
        },
    };
}

function makeEditorSpy(): {
    service: IEditorDecorationsService;
    calls: { uri: string; decorations: readonly IOverviewRulerDecoration[] }[];
    latestFor(suffix: string): { uri: string; decorations: readonly IOverviewRulerDecoration[] } | undefined;
    glyphs: { uri: string; owner: string; decorations: readonly IGlyphMarginDecoration[] }[];
} {
    const calls: { uri: string; decorations: readonly IOverviewRulerDecoration[] }[] = [];
    const glyphs: { uri: string; owner: string; decorations: readonly IGlyphMarginDecoration[] }[] = [];
    return {
        service: {
            ...NULL_EDITOR_DECORATIONS_SERVICE,
            setOverviewRulerDecorations: (uri, decorations) => calls.push({ uri, decorations }),
            setGlyphMarginDecorations: (uri, owner, decorations) => glyphs.push({ uri, owner, decorations }),
        },
        calls,
        latestFor: (suffix) => calls.filter((c) => c.uri.endsWith(suffix)).at(-1),
        glyphs,
    };
}

function makeFileSpy(): {
    service: IFileDecorationsService;
    calls: readonly { path: string; color?: number; badge?: string }[][];
    latest(): readonly { path: string; color?: number; badge?: string }[] | undefined;
} {
    const calls: { path: string; color?: number; badge?: string }[][] = [];
    return {
        service: { setFileDecorations: (entries) => calls.push([...entries]) },
        calls,
        latest: () => calls.at(-1),
    };
}

describe("ExtensionHost — decorations bridge (subprocess)", () => {
    it("scrollbar marks reach the editor with a resolved color; a type without overviewRulerColor marks nothing", async () => {
        const editorSpy = makeEditorSpy();
        const { resolver } = makeControllableResolver({
            "editorGutter.modifiedBackground": MODIFIED_GUTTER,
            "editor.background": 0x1e1e1e,
        });
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "a\nb\nc\nd\ne\n" },
            extensions: [extensionFixture("test.decorates", "decoratesEditorAndFiles.cjs")],
            editorDecorations: editorSpy.service,
            themeColorResolver: resolver,
        });
        try {
            await settle();
            const call = editorSpy.latestFor("main.ts");
            expect(call).toBeDefined();
            // A "flat" type without overviewRulerColor has no marks.
            expect(call!.decorations.map((d) => ({ line: d.range.start.line, color: d.color }))).toEqual([
                { line: 1, color: MODIFIED_GUTTER },
                { line: 3, color: MODIFIED_GUTTER },
            ]);
        } finally {
            await harness.dispose();
        }
    });

    it("a theme change re-resolves and re-pushes the held scrollbar marks", async () => {
        const editorSpy = makeEditorSpy();
        const themeCtl = makeControllableResolver({ "editorGutter.modifiedBackground": MODIFIED_GUTTER });
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "a\nb\nc\nd\ne\n" },
            extensions: [extensionFixture("test.decorates", "decoratesEditorAndFiles.cjs")],
            editorDecorations: editorSpy.service,
            themeColorResolver: themeCtl.resolver,
        });
        try {
            await settle();
            expect(editorSpy.latestFor("main.ts")?.decorations[0]?.color).toBe(MODIFIED_GUTTER);

            themeCtl.recolor({ "editorGutter.modifiedBackground": MODIFIED_GUTTER_LIGHT });
            const call = editorSpy.latestFor("main.ts");
            expect(call!.decorations.map((d) => d.color)).toEqual([MODIFIED_GUTTER_LIGHT, MODIFIED_GUTTER_LIGHT]);
        } finally {
            await harness.dispose();
        }
    });

    it("[api:ThemableDecorationRenderOptions.gutterIconPath] a data: URI icon crosses the wire and lands in the glyph lane", async () => {
        const editorSpy = makeEditorSpy();
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "a\nb\nc\nd\ne\n" },
            extensions: [extensionFixture("test.decorates", "decoratesEditorAndFiles.cjs")],
            editorDecorations: editorSpy.service,
            themeColorResolver: makeControllableResolver({}).resolver,
        });
        try {
            await settle();
            const glyphs = editorSpy.glyphs.filter((c) => c.uri.endsWith("main.ts")).at(-1);
            expect(glyphs?.owner).toMatch(/^ext:\d+$/);
            expect(glyphs?.decorations.map((g) => [g.line, g.glyph, g.color])).toEqual([
                [2, "▎", packRgba(0x00, 0xbc, 0xf2, 255)],
            ]);
        } finally {
            await harness.dispose();
        }
    });

    it("disposing a type clears its scrollbar marks in the editor", async () => {
        const editorSpy = makeEditorSpy();
        const { resolver } = makeControllableResolver({ "editorGutter.modifiedBackground": MODIFIED_GUTTER });
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "a\nb\nc\nd\ne\n" },
            extensions: [extensionFixture("test.decorates", "decoratesEditorAndFiles.cjs")],
            editorDecorations: editorSpy.service,
            themeColorResolver: resolver,
        });
        try {
            await settle();
            expect(editorSpy.latestFor("main.ts")?.decorations.length).toBe(2);

            await harness.commandRegistry.execute("test.disposeGutterType");
            await settle();
            expect(editorSpy.latestFor("main.ts")?.decorations).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("provider file decorations reach the tree; removal deletes the entry", async () => {
        const fileSpy = makeFileSpy();
        const themeCtl = makeControllableResolver({
            "gitDecoration.modifiedResourceForeground": MODIFIED_FILE,
        });
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [extensionFixture("test.decorates", "decoratesEditorAndFiles.cjs")],
            fileDecorations: fileSpy.service,
            themeColorResolver: themeCtl.resolver,
        });
        try {
            const notes = harness.writeFile("notes.md", "hello");
            await harness.commandRegistry.execute("test.fireFileDecoration", notes);
            await settle();

            const decorated = fileSpy.latest();
            expect(decorated).toEqual([{ path: notes, color: MODIFIED_FILE, badge: "M" }]);

            themeCtl.recolor({ "gitDecoration.modifiedResourceForeground": MODIFIED_FILE_LIGHT });
            expect(fileSpy.latest()).toEqual([{ path: notes, color: MODIFIED_FILE_LIGHT, badge: "M" }]);

            await harness.commandRegistry.execute("test.setCleared");
            await harness.commandRegistry.execute("test.fireFileDecoration", notes);
            await settle();
            expect(fileSpy.latest()).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
