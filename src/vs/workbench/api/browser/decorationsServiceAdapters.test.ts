import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import type { IExtensionTextDecorationSet } from "../../../editor/common/model/iExtensionTextDecoration.ts";
import type { IGlyphMarginDecoration } from "../../../editor/common/model/iGlyphMarginDecoration.ts";
import type { IOverviewRulerDecoration } from "../../../editor/common/model/iOverviewRulerDecoration.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { lightPlusTheme } from "../../services/themes/common/themes/lightPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";

import { EditorDecorationsServiceAdapter } from "./editorDecorationsServiceAdapter.ts";
import { ThemeColorResolverAdapter } from "./themeColorResolverAdapter.ts";

function fakeEditor(uri: Uri) {
    const received: (readonly IOverviewRulerDecoration[])[] = [];
    const receivedText: IExtensionTextDecorationSet[] = [];
    const receivedGlyphs: [string, readonly IGlyphMarginDecoration[]][] = [];
    return {
        uri,
        setOverviewRulerDecorations: (d: readonly IOverviewRulerDecoration[]) => received.push(d),
        setExtensionTextDecorations: (set: IExtensionTextDecorationSet) => receivedText.push(set),
        setGlyphMarginDecorations: (owner: string, d: readonly IGlyphMarginDecoration[]) =>
            receivedGlyphs.push([owner, d]),
        received,
        receivedText,
        receivedGlyphs,
    };
}

function fakeGroup(editors: ReturnType<typeof fakeEditor>[]): IEditorService {
    return {
        getEditors: () => editors,
    } as unknown as IEditorService;
}

describe("EditorDecorationsServiceAdapter", () => {
    it("pushes decorations to editors of the matching resource (and only to them)", () => {
        const match = fakeEditor(Uri.file("/proj/a.ts"));
        const other = fakeEditor(Uri.file("/proj/b.ts"));
        const adapter = new EditorDecorationsServiceAdapter(fakeGroup([match, other]));
        const decos = [{ range: createRange(1, 0, 1, 0), color: 0x123456 }];

        adapter.setOverviewRulerDecorations(Uri.file("/proj/a.ts").toString(), decos);

        expect(match.received).toEqual([decos]);
        expect(other.received).toEqual([]);
    });

    it("pushes text decorations to editors of the matching resource, apart from the scrollbar marks", () => {
        const match = fakeEditor(Uri.file("/proj/a.ts"));
        const other = fakeEditor(Uri.file("/proj/b.ts"));
        const adapter = new EditorDecorationsServiceAdapter(fakeGroup([match, other]));
        const decos = { key: 1, decorations: [{ range: createRange(1, 0, 1, 3), bg: 0x123456, isWholeLine: false }] };

        adapter.setExtensionTextDecorations(Uri.file("/proj/a.ts").toString(), decos);

        expect(match.receivedText).toEqual([decos]);
        expect(match.received).toEqual([]);
        expect(other.receivedText).toEqual([]);
    });

    it("pushes an owner's glyphs to editors of the matching resource", () => {
        const match = fakeEditor(Uri.file("/proj/a.ts"));
        const other = fakeEditor(Uri.file("/proj/b.ts"));
        const adapter = new EditorDecorationsServiceAdapter(fakeGroup([match, other]));
        const glyphs = [{ key: "1", line: 1, glyph: "●", colorToken: "editorLineNumber.foreground" }];

        adapter.setGlyphMarginDecorations(Uri.file("/proj/a.ts").toString(), "ext:1", glyphs);

        expect(match.receivedGlyphs).toEqual([["ext:1", glyphs]]);
        expect(other.receivedGlyphs).toEqual([]);
    });

    it("compares resources, not raw strings: Uri provides canonicalization", () => {
        // Only `IEditorService.openFile` normalizes the path: the resource arrives here already canonical.
        const match = fakeEditor(Uri.file(path.resolve("/proj/./sub/../a.ts")));
        const adapter = new EditorDecorationsServiceAdapter(fakeGroup([match]));
        adapter.setOverviewRulerDecorations(Uri.file("/proj/a.ts").toString(), []);
        expect(match.received).toEqual([[]]);
    });

    it("skips untitled buffers (untitled:)", () => {
        const untitled = fakeEditor(Uri.parse("untitled:Untitled-1"));
        const adapter = new EditorDecorationsServiceAdapter(fakeGroup([untitled]));
        adapter.setOverviewRulerDecorations(Uri.file("/proj/a.ts").toString(), [
            { range: createRange(0, 0, 0, 0), color: 1 },
        ]);
        expect(untitled.received).toEqual([]);
    });
});

describe("ThemeColorResolverAdapter", () => {
    it("resolves an active theme color id to packed RGB; unknown id → undefined", () => {
        const theme = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
        const adapter = new ThemeColorResolverAdapter(theme);
        expect(adapter.resolve("editorGutter.modifiedBackground")).toBe(
            theme.theme.getColor("editorGutter.modifiedBackground"),
        );
        expect(adapter.resolve("no.such.color")).toBeUndefined();
    });

    it("onDidChange swallows the immediate call and fires only on theme change", () => {
        const theme = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
        const adapter = new ThemeColorResolverAdapter(theme);
        let fired = 0;
        const disposable = adapter.onDidChange(() => fired++);
        expect(fired).toBe(0);

        theme.setTheme(WorkbenchTheme.fromThemeFile(lightPlusTheme));
        expect(fired).toBe(1);

        disposable.dispose();
        theme.setTheme(WorkbenchTheme.fromThemeFile(darkPlusTheme));
        expect(fired).toBe(1);
    });
});
