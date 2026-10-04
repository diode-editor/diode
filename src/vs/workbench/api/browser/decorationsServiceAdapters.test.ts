import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import type { IGutterChangeDecoration } from "../../../editor/common/model/iGutterChangeDecoration.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import type { EditorService } from "../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { lightPlusTheme } from "../../services/themes/common/themes/lightPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";

import { EditorDecorationsServiceAdapter } from "./editorDecorationsServiceAdapter.ts";
import { FileDecorationsServiceAdapter } from "./fileDecorationsServiceAdapter.ts";
import { ThemeColorResolverAdapter } from "./themeColorResolverAdapter.ts";

/** Мини-редактор с наблюдаемым setGutterChangeDecorations. */
function fakeEditor(uri: Uri) {
    const received: (readonly IGutterChangeDecoration[])[] = [];
    return {
        uri,
        setGutterChangeDecorations: (d: readonly IGutterChangeDecoration[]) => received.push(d),
        received,
    };
}

function fakeGroup(editors: ReturnType<typeof fakeEditor>[]): EditorService {
    return {
        getEditors: () => editors,
    } as unknown as EditorService;
}

describe("EditorDecorationsServiceAdapter", () => {
    it("проталкивает декорации в редакторы совпадающего ресурса (и только в них)", () => {
        const match = fakeEditor(Uri.file("/proj/a.ts"));
        const other = fakeEditor(Uri.file("/proj/b.ts"));
        const adapter = new EditorDecorationsServiceAdapter(fakeGroup([match, other]));
        const decos = [{ range: createRange(1, 0, 1, 0), color: 0x123456 }];

        adapter.setGutterChangeDecorations(Uri.file("/proj/a.ts").toString(), decos);

        expect(match.received).toEqual([decos]);
        expect(other.received).toEqual([]);
    });

    it("сверяет ресурсы, а не сырые строки: канонизацию даёт Uri", () => {
        // Ненормализованный путь не долетает сюда: `path.resolve` стоит в единственной
        // точке подъёма (`EditorService.openFile`), а сюда ресурс приходит уже
        // каноничным — субпроцесс шлёт `document.uri.toString()`.
        const match = fakeEditor(Uri.file(path.resolve("/proj/./sub/../a.ts")));
        const adapter = new EditorDecorationsServiceAdapter(fakeGroup([match]));
        adapter.setGutterChangeDecorations(Uri.file("/proj/a.ts").toString(), []);
        expect(match.received).toEqual([[]]);
    });

    it("безымянные буферы (untitled:) пропускаются", () => {
        const untitled = fakeEditor(Uri.parse("untitled:Untitled-1"));
        const adapter = new EditorDecorationsServiceAdapter(fakeGroup([untitled]));
        adapter.setGutterChangeDecorations(Uri.file("/proj/a.ts").toString(), [
            { range: createRange(0, 0, 0, 0), color: 1 },
        ]);
        expect(untitled.received).toEqual([]);
    });
});

describe("FileDecorationsServiceAdapter", () => {
    it("делегирует setFileDecorations в цель (ExplorerService)", () => {
        const calls: unknown[] = [];
        const explorer = { setFileDecorations: (e: unknown) => calls.push(e) };
        const adapter = new FileDecorationsServiceAdapter(explorer);
        const entries = [{ path: "/proj/notes.md", color: 0xe2c08d, badge: "M" }];
        adapter.setFileDecorations(entries);
        expect(calls).toEqual([entries]);
    });
});

describe("ThemeColorResolverAdapter", () => {
    it("резолвит id цвета активной темы в packed-RGB; неизвестный id → undefined", () => {
        const theme = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
        const adapter = new ThemeColorResolverAdapter(theme);
        expect(adapter.resolve("editorGutter.modifiedBackground")).toBe(
            theme.theme.getColor("editorGutter.modifiedBackground"),
        );
        expect(adapter.resolve("no.such.color")).toBeUndefined();
    });

    it("onDidChange глотает немедленный вызов, стреляет только на смене темы", () => {
        const theme = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
        const adapter = new ThemeColorResolverAdapter(theme);
        let fired = 0;
        const disposable = adapter.onDidChange(() => fired++);
        expect(fired).toBe(0); // начальный синхронный вызов проглочен

        theme.setTheme(WorkbenchTheme.fromThemeFile(lightPlusTheme));
        expect(fired).toBe(1);

        disposable.dispose();
        theme.setTheme(WorkbenchTheme.fromThemeFile(darkPlusTheme));
        expect(fired).toBe(1); // после dispose — тишина
    });
});
