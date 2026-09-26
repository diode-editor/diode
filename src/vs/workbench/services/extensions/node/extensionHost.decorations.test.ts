import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { IEditorDecorationsService } from "../../../api/common/iEditorDecorationsService.ts";
import type { IFileDecorationsService } from "../../../api/common/iFileDecorationsService.ts";
import type { IThemeColorResolver } from "../../../api/common/iThemeColorResolver.ts";
import { ColorThemeKind } from "../../../api/common/vscodeTypes.ts";

// Резолвнутые цвета (packed-RGB), которые спай-адаптеры должны получить.
const MODIFIED_GUTTER = 0x1b81a8;
const MODIFIED_GUTTER_LIGHT = 0x2090d3;
const MODIFIED_FILE = 0xe2c08d;
const MODIFIED_FILE_LIGHT = 0x895503;

/** Контролируемый резолвер темы: карта id→цвет + ручной триггер смены. */
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
    calls: { uri: string; decorations: readonly IGutterChangeDecoration[] }[];
    latestFor(suffix: string): { uri: string; decorations: readonly IGutterChangeDecoration[] } | undefined;
} {
    const calls: { uri: string; decorations: readonly IGutterChangeDecoration[] }[] = [];
    return {
        service: { setGutterChangeDecorations: (uri, decorations) => calls.push({ uri, decorations }) },
        calls,
        // Ресурс — uri ("file:///…/main.ts"), поэтому суффикс имени файла по нему матчится.
        latestFor: (suffix) => calls.filter((c) => c.uri.endsWith(suffix)).at(-1),
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
    it("gutter change-bar декорации доезжают до редактора с резолвнутым цветом; non-gutter тип игнорируется", async () => {
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
            // gutter-тип дал два диапазона (строки 1 и 3); «плоский» тип без
            // overviewRulerColor не проецируется вовсе.
            expect(call!.decorations.map((d) => ({ line: d.range.start.line, color: d.color }))).toEqual([
                { line: 1, color: MODIFIED_GUTTER },
                { line: 3, color: MODIFIED_GUTTER },
            ]);
            // Modified-гуттер цвет → бар рисуется пунктиром (VS Code dirty-diff).
            expect(call!.decorations.every((d) => d.dashed === true)).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("смена темы пере-резолвит и пере-push'ит держимые gutter-декорации", async () => {
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

    it("dispose типа гасит его gutter-декорации в редакторе", async () => {
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

    it("файловые декорации проекта провайдера доезжают до дерева; снятие удаляет запись", async () => {
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

            // Смена темы пере-резолвит цвет имени файла.
            themeCtl.recolor({ "gitDecoration.modifiedResourceForeground": MODIFIED_FILE_LIGHT });
            expect(fileSpy.latest()).toEqual([{ path: notes, color: MODIFIED_FILE_LIGHT, badge: "M" }]);

            // Провайдер перешёл в «снято» → следующий fire снимает декорацию файла.
            await harness.commandRegistry.execute("test.setCleared");
            await harness.commandRegistry.execute("test.fireFileDecoration", notes);
            await settle();
            expect(fileSpy.latest()).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
