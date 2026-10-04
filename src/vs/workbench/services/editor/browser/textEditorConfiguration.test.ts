import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { loadConfiguration } from "../../../../platform/configuration/node/configurationService.ts";
import { resolveUserDataPaths } from "../../../../platform/environment/node/userDataPaths.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../../../common/configuration/configurationContributions.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

/** Сервис с заданным конфигом: настройки применяет его `editorConfiguration`. */
function createEditorService(overrides: { configurationService?: IConfigurationService } = {}): EditorService {
    return new EditorService(
        new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        NULL_LANGUAGE_SERVICE,
        overrides.configurationService ?? createTestConfigurationService(),
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
        undefined,
        undefined,
        undefined,
        undefined,
        diskFileService(),
    );
}

/** Minimal IConfigurationService that serves a fixed key/value map. */
function stubConfigurationService(values: Record<string, unknown>): IConfigurationService {
    return createTestConfigurationService(values);
}

/**
 * `TextEditorConfiguration` поверх настоящего `EditorService`: настройки
 * новых редакторов, Alt+Z, live-reload и отступ с defaults-слоем реестра.
 */
describe("TextEditorConfiguration", () => {
    let tmpDir: string;
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-test-" });
        tmpDir = ws.dir;
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string, content: string): string {
        const filePath = path.join(tmpDir, name);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, "utf-8");
        return filePath;
    }

    describe("applies configuration to new editors", () => {
        it("секция языка документа бьёт плоское значение и переприменяется при смене языка", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({
                    "editor.detectIndentation": false,
                    "editor.insertSpaces": true,
                    "[makefile]": { "editor.insertSpaces": false },
                }),
            });
            ctrl.openFile(writeFile("rules", "all:\n"));
            const editor = ctrl.getActiveEditor()!;
            expect(editor.viewState.insertSpaces).toBe(true);

            editor.setLanguage("makefile");

            expect(editor.viewState.insertSpaces).toBe(false);
        });

        it("detached-панель (Output) настраивается при создании, как вкладка", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({ "editor.wordWrap": "on" }),
            });

            const pane = ctrl.openDetached(Uri.from({ scheme: "output", path: "extensions" }), "log");

            expect(pane.viewState.wordWrap).toBe("on");
        });

        it("безымянный буфер настраивается при создании, как вкладка файла", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({ "editor.wordWrap": "on" }),
            });

            ctrl.newUntitled();

            expect(ctrl.getActiveEditor()!.viewState.wordWrap).toBe("on");
        });

        it("seeds indent options from the configuration service", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({
                    "editor.tabSize": 2,
                    "editor.insertSpaces": true,
                }),
            });
            ctrl.openFile(writeFile("a.ts", "const x = 1;"));

            const editor = ctrl.getActiveEditor()!;
            expect(editor.viewState.tabSize).toBe(2);
            expect(editor.viewState.insertSpaces).toBe(true);
        });

        it("editor.occurrencesHighlight: off гасит подсветку вхождений, дефолт — включает", () => {
            const spy = vi.spyOn(TextEditorPane.prototype, "setOccurrenceHighlightEnabled");
            try {
                createEditorService({
                    configurationService: stubConfigurationService({ "editor.occurrencesHighlight": "off" }),
                }).openFile(writeFile("a.ts", "const x = 1;"));
                expect(spy).toHaveBeenLastCalledWith(false);

                createEditorService().openFile(writeFile("b.ts", "const y = 1;"));
                expect(spy).toHaveBeenLastCalledWith(true);
            } finally {
                spy.mockRestore();
            }
        });

        it("seeds cursorSurroundingLines from the configuration service", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({
                    "editor.cursorSurroundingLines": 5,
                }),
            });
            ctrl.openFile(writeFile("a.ts", "const x = 1;"));

            expect(ctrl.getActiveEditor()!.viewState.cursorSurroundingLines).toBe(5);
        });

        it("seeds wordWrap and wordWrapColumn from the configuration service", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({
                    "editor.wordWrap": "bounded",
                    "editor.wordWrapColumn": 40,
                }),
            });
            ctrl.openFile(writeFile("a.ts", "const x = 1;"));

            const viewState = ctrl.getActiveEditor()!.viewState;
            expect(viewState.wordWrap).toBe("bounded");
            expect(viewState.wordWrapColumn).toBe(40);
        });

        it("режим on применяется как есть (не через column-ветку)", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({
                    "editor.wordWrap": "on",
                }),
            });
            ctrl.openFile(writeFile("a.ts", "const x = 1;"));
            expect(ctrl.getActiveEditor()!.viewState.wordWrap).toBe("on");
        });

        it("невалидное значение editor.wordWrap деградирует к off", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({
                    "editor.wordWrap": "sideways",
                }),
            });
            ctrl.openFile(writeFile("a.ts", "const x = 1;"));

            const viewState = ctrl.getActiveEditor()!.viewState;
            expect(viewState.wordWrap).toBe("off");
            expect(viewState.wordWrapColumn).toBe(80);
        });
    });

    describe("toggleWordWrap (Alt+Z)", () => {
        it("переключает off ↔ on поверх дефолтного конфига у всех открытых редакторов", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));
            const [first, second] = [ctrl.getEditors()[0], ctrl.getEditors()[1]];
            expect(first.viewState.wordWrap).toBe("off");

            ctrl.editorConfiguration.toggleWordWrap();
            expect(first.viewState.wordWrap).toBe("on");
            expect(second.viewState.wordWrap).toBe("on");

            ctrl.editorConfiguration.toggleWordWrap();
            expect(first.viewState.wordWrap).toBe("off");
            expect(second.viewState.wordWrap).toBe("off");
        });

        it("повторное включение возвращает КОНФИГУРНЫЙ режим, а не plain on", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({
                    "editor.wordWrap": "wordWrapColumn",
                    "editor.wordWrapColumn": 60,
                }),
            });
            ctrl.openFile(writeFile("a.ts", "a"));
            const viewState = ctrl.getActiveEditor()!.viewState;
            expect(viewState.wordWrap).toBe("wordWrapColumn");

            ctrl.editorConfiguration.toggleWordWrap();
            expect(viewState.wordWrap).toBe("off");

            ctrl.editorConfiguration.toggleWordWrap();
            expect(viewState.wordWrap).toBe("wordWrapColumn");
            expect(viewState.wordWrapColumn).toBe(60);
        });

        it("override переживает применение конфига к новому редактору", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.editorConfiguration.toggleWordWrap();

            ctrl.openFile(writeFile("b.ts", "b"));
            expect(ctrl.getActiveEditor()!.viewState.wordWrap).toBe("on");
        });
    });

    describe("live-reloads editor settings into already-open editors", () => {
        // Real ConfigurationService over a temp settings.json — editing the file and
        // calling reload() emits onDidChangeConfiguration, which the service must apply
        // to editors that are ALREADY open (not just newly created ones).
        async function realConfig(initial: string) {
            const cfgWs = createTempWorkspace({ prefix: "diode-es-cfg-" });
            const p = resolveUserDataPaths({ homedir: "/never", userDataDir: cfgWs.dir });
            const write = (content: string): void => {
                fs.mkdirSync(path.dirname(p.settingsFile), { recursive: true });
                fs.writeFileSync(p.settingsFile, content, "utf-8");
            };
            write(initial);
            const cfg = await loadConfiguration(p);
            return {
                cfg,
                write,
                dispose: () => {
                    cfgWs.dispose();
                },
            };
        }

        it("re-applies editor.tabSize / insertSpaces to an open editor", async () => {
            const { cfg, write, dispose } = await realConfig(`{ "editor.tabSize": 2, "editor.insertSpaces": true }`);
            const ctrl = createEditorService({ configurationService: cfg });
            ctrl.openFile(writeFile("a.ts", "const x = 1;"));
            const editor = ctrl.getActiveEditor()!;
            expect(editor.viewState.tabSize).toBe(2);

            write(`{ "editor.tabSize": 8, "editor.insertSpaces": false }`);
            await cfg.reload();

            expect(editor.viewState.tabSize).toBe(8);
            expect(editor.viewState.insertSpaces).toBe(false);

            ctrl.dispose();
            dispose();
        });

        it("does not touch editors when only non-editor settings change", async () => {
            const { cfg, write, dispose } = await realConfig(`{ "editor.tabSize": 2 }`);
            const ctrl = createEditorService({ configurationService: cfg });
            ctrl.openFile(writeFile("a.ts", "const x = 1;"));
            const editor = ctrl.getActiveEditor()!;
            expect(editor.viewState.tabSize).toBe(2);
            const reapplied = vi.spyOn(editor, "applyIndentConfiguration");

            // Only a workbench key changes → affectsConfiguration("editor") is false,
            // the service's handler early-returns and the editor is left as-is.
            write(`{ "editor.tabSize": 2, "workbench.colorTheme": "Monokai" }`);
            await cfg.reload();

            expect(editor.viewState.tabSize).toBe(2);
            expect(reapplied).not.toHaveBeenCalled();

            ctrl.dispose();
            dispose();
        });
    });

    // Конфиг ровно как в проде: defaults-слой собран из реестра. Именно его
    // отсутствие в стабах и прятало баг — `get("editor.tabSize")` отдавал
    // дефолт 4 на файле с любым отступом, а `setIndentOptions` глушил детекцию.
    describe("indentation: конфиг с defaults-слоем реестра", () => {
        const TWO_SPACE_FILE = "function foo() {\n  const x = 1;\n}\n";

        async function productionConfig(settings: string) {
            const cfgWs = createTempWorkspace({ prefix: "diode-es-indent-" });
            const p = resolveUserDataPaths({ homedir: "/never", userDataDir: cfgWs.dir });
            fs.mkdirSync(path.dirname(p.settingsFile), { recursive: true });
            fs.writeFileSync(p.settingsFile, settings, "utf-8");
            const cfg = await loadConfiguration(
                p,
                undefined,
                undefined,
                new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS),
            );
            return {
                cfg,
                dispose: () => {
                    cfgWs.dispose();
                },
            };
        }

        it("определяет отступ по файлу, а не по дефолту editor.tabSize", async () => {
            const { cfg, dispose } = await productionConfig("{}");
            const ctrl = createEditorService({ configurationService: cfg });

            ctrl.openFile(writeFile("a.ts", TWO_SPACE_FILE));

            expect(ctrl.getActiveEditor()!.viewState.tabSize).toBe(2);
            expect(ctrl.getActiveEditor()!.viewState.insertSpaces).toBe(true);

            ctrl.dispose();
            dispose();
        });

        it("видит табы, хотя дефолт editor.insertSpaces — true", async () => {
            const { cfg, dispose } = await productionConfig("{}");
            const ctrl = createEditorService({ configurationService: cfg });

            ctrl.openFile(writeFile("b.ts", "function foo() {\n\tconst x = 1;\n}\n"));

            expect(ctrl.getActiveEditor()!.viewState.insertSpaces).toBe(false);

            ctrl.dispose();
            dispose();
        });

        it("editor.detectIndentation: false возвращает власть настройкам", async () => {
            const { cfg, dispose } = await productionConfig(
                `{ "editor.detectIndentation": false, "editor.tabSize": 8 }`,
            );
            const ctrl = createEditorService({ configurationService: cfg });

            ctrl.openFile(writeFile("c.ts", TWO_SPACE_FILE));

            expect(ctrl.getActiveEditor()!.viewState.tabSize).toBe(8);

            ctrl.dispose();
            dispose();
        });
    });

    describe("applyConfigurationToEditor partial options", () => {
        it("applies only tabSize when insertSpaces is not configured", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({ "editor.tabSize": 8 }),
            });
            ctrl.openFile(writeFile("a.ts", "x"));

            expect(ctrl.getActiveEditor()?.viewState.tabSize).toBe(8);
        });

        it("applies only insertSpaces when tabSize is not configured", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({ "editor.insertSpaces": false }),
            });
            ctrl.openFile(writeFile("a.ts", "x"));

            expect(ctrl.getActiveEditor()?.viewState.insertSpaces).toBe(false);
        });
    });
});
