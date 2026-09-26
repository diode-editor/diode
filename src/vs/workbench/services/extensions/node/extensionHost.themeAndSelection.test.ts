import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { withCursorChangeSource } from "../../../../editor/common/core/cursorChangeSource.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { IThemeColorResolver } from "../../../api/common/iThemeColorResolver.ts";
import { ColorThemeKind, TextEditorSelectionChangeKind } from "../../../api/common/vscodeTypes.ts";
import { lightPlusTheme } from "../../themes/common/themes/lightPlus.ts";
import { monokaiTheme } from "../../themes/common/themes/monokai.ts";

interface IThemeEvent {
    kind: number;
    isLight: boolean;
    matchesNamespace: boolean;
}

interface ISelectionEvent {
    fileName: string;
    kind: number | null;
    isMouse: boolean;
    selections: [number, number, number, number][];
    isActiveEditor: boolean;
    editorSelection: [number, number];
}

interface IReport {
    themeAtActivate: number;
    isDarkAtActivate: boolean;
    themeNow: number;
    themeEvents: IThemeEvent[];
    selectionEvents: ISelectionEvent[];
}

const FIXTURE = extensionFixture("test.themeSelection", "watchesThemeAndSelection.cjs");

async function makeHarness() {
    return createExtensionTestHarness({
        initialFile: { name: "main.ts", content: "const a = 1;\nconst b = 2;\nconst c = 3;\n" },
        extensions: [FIXTURE],
    });
}

/** Резолвер темы с заданным видом — чтобы отличить присланное от дефолта субпроцесса. */
function resolverWithKind(kind: ColorThemeKind): IThemeColorResolver {
    return {
        resolve: () => undefined,
        kind: () => kind,
        onDidChange: () => ({ dispose: () => undefined }),
    };
}

describe("ExtensionHost — window.activeColorTheme (subprocess)", () => {
    it("тема доезжает ДО activate(): расширение видит настоящий вид, а не заглушку", { timeout: 60_000 }, async () => {
        const harness = await makeHarness();
        try {
            const report = (await harness.commandRegistry.execute("test.themeSelection.report")) as IReport;
            // Харнесс стартует на Dark+.
            expect(report.themeAtActivate).toBe(ColorThemeKind.Dark);
            expect(report.isDarkAtActivate).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    // Вид, которого НЕТ среди дефолтов: у субпроцесса своё семя `Dark`, поэтому
    // на тёмной теме «семя доехало» и «семя потерялось» выглядят одинаково.
    // HighContrast отличает одно от другого — без handshake-пуша тест краснеет.
    it("семя на handshake: расширение видит тему хоста, а не собственный дефолт", { timeout: 60_000 }, async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const a = 1;\n" },
            extensions: [FIXTURE],
            themeColorResolver: resolverWithKind(ColorThemeKind.HighContrast),
        });
        try {
            const report = (await harness.commandRegistry.execute("test.themeSelection.report")) as IReport;
            expect(report.themeAtActivate).toBe(ColorThemeKind.HighContrast);
            expect(report.isDarkAtActivate).toBe(false);
            // Событий смены при этом не было — приехало именно семя.
            expect(report.themeEvents).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("смена темы стреляет onDidChangeActiveColorTheme с новым видом", { timeout: 60_000 }, async () => {
        const harness = await makeHarness();
        try {
            harness.themeService.setTheme(WorkbenchTheme.fromThemeFile(lightPlusTheme));
            await settle();

            const report = (await harness.commandRegistry.execute("test.themeSelection.report")) as IReport;
            expect(report.themeEvents).toHaveLength(1);
            expect(report.themeEvents[0].kind).toBe(ColorThemeKind.Light);
            expect(report.themeEvents[0].isLight).toBe(true);
            expect(report.themeEvents[0].matchesNamespace).toBe(true);
            expect(report.themeNow).toBe(ColorThemeKind.Light);
        } finally {
            await harness.dispose();
        }
    });

    it(
        "переход между двумя тёмными темами тоже событие (vscode: «changed or has changes»)",
        { timeout: 60_000 },
        async () => {
            const harness = await makeHarness();
            try {
                harness.themeService.setTheme(WorkbenchTheme.fromThemeFile(monokaiTheme));
                await settle();
                const report = (await harness.commandRegistry.execute("test.themeSelection.report")) as IReport;
                expect(report.themeEvents.map((e) => e.kind)).toEqual([ColorThemeKind.Dark]);
            } finally {
                await harness.dispose();
            }
        },
    );

    it("каждая смена темы — своё событие, порядок сохраняется", { timeout: 60_000 }, async () => {
        const harness = await makeHarness();
        try {
            harness.themeService.setTheme(WorkbenchTheme.fromThemeFile(lightPlusTheme));
            await settle();
            harness.themeService.setTheme(WorkbenchTheme.fromThemeFile(monokaiTheme));
            await settle();

            const report = (await harness.commandRegistry.execute("test.themeSelection.report")) as IReport;
            expect(report.themeEvents.map((e) => e.kind)).toEqual([ColorThemeKind.Light, ColorThemeKind.Dark]);
            expect(report.themeNow).toBe(ColorThemeKind.Dark);
        } finally {
            await harness.dispose();
        }
    });
});

describe("ExtensionHost — window.onDidChangeTextEditorSelection (subprocess)", () => {
    it("движение каретки доезжает до расширения с редактором, выделениями и видом", { timeout: 60_000 }, async () => {
        const harness = await makeHarness();
        try {
            const editor = harness.group.getActiveTabEditor();
            expect(editor).not.toBeNull();
            withCursorChangeSource("mouse", () => {
                editor!.viewState.selections = [createSelection(1, 2, 1, 6)];
            });
            await settle();

            const report = (await harness.commandRegistry.execute("test.themeSelection.report")) as IReport;
            expect(report.selectionEvents).toHaveLength(1);
            const event = report.selectionEvents[0];
            expect(event.fileName.endsWith("main.ts")).toBe(true);
            expect(event.selections).toEqual([[1, 2, 1, 6]]);
            expect(event.kind).toBe(TextEditorSelectionChangeKind.Mouse);
            expect(event.isMouse).toBe(true);
            expect(event.isActiveEditor).toBe(true);
            // Слушатель видит УЖЕ новое выделение через сам редактор.
            expect(event.editorSelection).toEqual([1, 6]);
        } finally {
            await harness.dispose();
        }
    });

    it(
        "вид едет от жеста: клавиатура → Keyboard, команда → Command, без жеста → null",
        { timeout: 60_000 },
        async () => {
            const harness = await makeHarness();
            try {
                const editor = harness.group.getActiveTabEditor();
                withCursorChangeSource("keyboard", () => {
                    editor!.viewState.selections = [createSelection(0, 1, 0, 1)];
                });
                await settle();
                withCursorChangeSource("command", () => {
                    editor!.viewState.selections = [createSelection(0, 2, 0, 2)];
                });
                await settle();
                editor!.viewState.selections = [createSelection(0, 3, 0, 3)];
                await settle();

                const report = (await harness.commandRegistry.execute("test.themeSelection.report")) as IReport;
                expect(report.selectionEvents.map((e) => e.kind)).toEqual([
                    TextEditorSelectionChangeKind.Keyboard,
                    TextEditorSelectionChangeKind.Command,
                    null,
                ]);
            } finally {
                await harness.dispose();
            }
        },
    );

    it("мульти-курсор едет целиком, первое выделение — первичное", { timeout: 60_000 }, async () => {
        const harness = await makeHarness();
        try {
            const editor = harness.group.getActiveTabEditor();
            editor!.viewState.selections = [createSelection(0, 0, 0, 2), createSelection(2, 1, 2, 4)];
            await settle();

            const report = (await harness.commandRegistry.execute("test.themeSelection.report")) as IReport;
            expect(report.selectionEvents.at(-1)?.selections).toEqual([
                [0, 0, 0, 2],
                [2, 1, 2, 4],
            ]);
        } finally {
            await harness.dispose();
        }
    });
});
