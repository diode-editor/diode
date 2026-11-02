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

function stubConfigurationService(values: Record<string, unknown>): IConfigurationService {
    return createTestConfigurationService(values);
}

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
        it("the document language section overrides the flat value and is reapplied on language change", () => {
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

        it("a detached pane (Output) is configured on creation, like a tab", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({ "editor.wordWrap": "on" }),
            });

            const pane = ctrl.openDetached(Uri.from({ scheme: "output", path: "extensions" }), "log");

            expect(pane.viewState.wordWrap).toBe("on");
        });

        it("an untitled buffer is configured on creation, like a file tab", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({ "editor.wordWrap": "on" }),
            });

            ctrl.newUntitled();

            expect(ctrl.getActiveEditor()!.viewState.wordWrap).toBe("on");
        });

        it("an extension's untitled buffer is configured when shown", async () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({ "editor.wordWrap": "on" }),
            });

            await ctrl.openUri(ctrl.createUntitled({ content: "x" }));

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

        it("editor.scrollbarMarkers reaches the editor, auto by default", () => {
            const spy = vi.spyOn(TextEditorPane.prototype, "setScrollbarMarkers");
            try {
                createEditorService({
                    configurationService: stubConfigurationService({ "editor.scrollbarMarkers": "outside" }),
                }).openFile(writeFile("a.ts", "const x = 1;"));
                expect(spy).toHaveBeenLastCalledWith("outside");

                createEditorService().openFile(writeFile("b.ts", "const y = 1;"));
                expect(spy).toHaveBeenLastCalledWith("auto");
            } finally {
                spy.mockRestore();
            }
        });

        it("editor.foldingMaximumRegions reaches the editor, 5000 by default", () => {
            const spy = vi.spyOn(TextEditorPane.prototype, "setFoldingMaximumRegions");
            try {
                createEditorService({
                    configurationService: stubConfigurationService({ "editor.foldingMaximumRegions": 100 }),
                }).openFile(writeFile("a.ts", "const x = 1;"));
                expect(spy).toHaveBeenLastCalledWith(100);

                createEditorService().openFile(writeFile("b.ts", "const y = 1;"));
                expect(spy).toHaveBeenLastCalledWith(5000);
            } finally {
                spy.mockRestore();
            }
        });

        it("editor.links reaches the editor by language; default on", () => {
            const spy = vi.spyOn(TextEditorPane.prototype, "setLinksEnabled");
            try {
                const ctrl = createEditorService({
                    configurationService: stubConfigurationService({ "[markdown]": { "editor.links": false } }),
                });
                ctrl.openFile(writeFile("links.txt", "x"));
                expect(spy).toHaveBeenLastCalledWith(true);

                ctrl.getActiveEditor()!.setLanguage("markdown");
                expect(spy).toHaveBeenLastCalledWith(false);
            } finally {
                spy.mockRestore();
            }
        });

        it("color decorator settings reach the editor by language, the limit floored; defaults: on, auto, 500", () => {
            const spy = vi.spyOn(TextEditorPane.prototype, "setColorDecorators");
            try {
                const ctrl = createEditorService({
                    configurationService: stubConfigurationService({
                        "editor.colorDecoratorsLimit": 2.7,
                        "[css]": { "editor.colorDecorators": false, "editor.defaultColorDecorators": "never" },
                    }),
                });
                ctrl.openFile(writeFile("a.css", "a { color: #fff; }"));
                expect(spy).toHaveBeenLastCalledWith({ enabled: true, defaultEnablement: "auto", limit: 2 });

                ctrl.getActiveEditor()!.setLanguage("css");
                expect(spy).toHaveBeenLastCalledWith({ enabled: false, defaultEnablement: "never", limit: 2 });

                createEditorService().openFile(writeFile("b.css", "a {}"));
                expect(spy).toHaveBeenLastCalledWith({ enabled: true, defaultEnablement: "auto", limit: 500 });
            } finally {
                spy.mockRestore();
            }
        });

        it("editor.colorDecoratorsLimit out of range is clamped to 1..1000000, as upstream's integer option", () => {
            const spy = vi.spyOn(TextEditorPane.prototype, "setColorDecorators");
            try {
                for (const [value, limit] of [
                    [0, 1],
                    [-5, 1],
                    [2e6, 1_000_000],
                ] as const) {
                    createEditorService({
                        configurationService: stubConfigurationService({ "editor.colorDecoratorsLimit": value }),
                    }).openFile(writeFile(`limit${String(value)}.css`, "a { color: #fff; }"));
                    expect(spy).toHaveBeenLastCalledWith({ enabled: true, defaultEnablement: "auto", limit });
                }
            } finally {
                spy.mockRestore();
            }
        });

        it("editor.occurrencesHighlightDelay reaches the word highlighter", () => {
            const spy = vi.spyOn(TextEditorPane.prototype, "setOccurrenceHighlightDelay");
            try {
                createEditorService({
                    configurationService: stubConfigurationService({ "editor.occurrencesHighlightDelay": 300 }),
                }).openFile(writeFile("a.ts", "const x = 1;"));
                expect(spy).toHaveBeenLastCalledWith(300);
            } finally {
                spy.mockRestore();
            }
        });

        it("editor.occurrencesHighlight: off disables occurrence highlighting, the default enables it", () => {
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

        it("mode on is applied as is (not via the column branch)", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({
                    "editor.wordWrap": "on",
                }),
            });
            ctrl.openFile(writeFile("a.ts", "const x = 1;"));
            expect(ctrl.getActiveEditor()!.viewState.wordWrap).toBe("on");
        });

        it("an invalid editor.wordWrap value falls back to off", () => {
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

    describe("inlay hints", () => {
        function appliedOptions() {
            return vi.spyOn(TextEditorPane.prototype, "setInlayHints");
        }

        it("editor.codeLens: on by default, a language override turns it off", () => {
            const spy = vi.spyOn(TextEditorPane.prototype, "setCodeLens");
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({ "[css]": { "editor.codeLens": false } }),
            });
            ctrl.openFile(writeFile("a.ts", "a"));
            expect(spy.mock.lastCall?.[0].enabled).toBe(true);
            ctrl.getActiveEditor()!.setLanguage("css");
            expect(spy.mock.lastCall?.[0].enabled).toBe(false);
            spy.mockRestore();
        });

        it("defaults: on, no padding, 43, normal", () => {
            const spy = appliedOptions();
            createEditorService().openFile(writeFile("a.ts", "a"));
            expect(spy).toHaveBeenLastCalledWith({
                enabled: true,
                padding: false,
                maximumLength: 43,
                fontStyle: "normal",
            });
            spy.mockRestore();
        });

        it("every key reaches the editor through its [language] section", () => {
            const spy = appliedOptions();
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({
                    "[css]": {
                        "editor.inlayHints.enabled": "off",
                        "editor.inlayHints.padding": true,
                        "editor.inlayHints.maximumLength": 7,
                        "diode.editor.inlayHints.fontStyle": "dim",
                    },
                }),
            });
            ctrl.openFile(writeFile("a.css", "a {}"));
            ctrl.getActiveEditor()!.setLanguage("css");
            expect(spy).toHaveBeenLastCalledWith({ enabled: false, padding: true, maximumLength: 7, fontStyle: "dim" });
            spy.mockRestore();
        });

        it.each([
            ["on", true],
            ["onUnlessPressed", true],
            ["offUnlessPressed", false],
            ["off", false],
            [true, true],
            [false, false],
            ["sideways", true],
        ])("editor.inlayHints.enabled %j shows hints: %j", (value, enabled) => {
            const spy = appliedOptions();
            createEditorService({
                configurationService: stubConfigurationService({ "editor.inlayHints.enabled": value }),
            }).openFile(writeFile("a.ts", "a"));
            expect(spy.mock.lastCall?.[0].enabled).toBe(enabled);
            spy.mockRestore();
        });

        it("a negative maximumLength clamps to 0, a fractional one truncates", () => {
            const spy = appliedOptions();
            for (const [value, expected] of [
                [-5, 0],
                [7.9, 7],
            ]) {
                createEditorService({
                    configurationService: stubConfigurationService({ "editor.inlayHints.maximumLength": value }),
                }).openFile(writeFile("a.ts", "a"));
                expect(spy.mock.lastCall?.[0].maximumLength).toBe(expected);
            }
            spy.mockRestore();
        });

        it("the toggle flips every open editor and a new one; a second toggle gives the configuration back", () => {
            const spy = appliedOptions();
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));
            spy.mockClear();
            ctrl.editorConfiguration.toggleInlayHints("typescript");
            expect(spy.mock.calls.map(([options]) => options.enabled)).toEqual([false, false]);
            ctrl.openFile(writeFile("c.ts", "c"));
            expect(spy.mock.lastCall?.[0].enabled).toBe(false);
            spy.mockClear();
            ctrl.editorConfiguration.toggleInlayHints("typescript");
            expect(spy.mock.calls.every(([options]) => options.enabled)).toBe(true);
            spy.mockRestore();
        });

        it("the toggle starts from what the active language shows", () => {
            const spy = appliedOptions();
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({ "[css]": { "editor.inlayHints.enabled": "off" } }),
            });
            ctrl.openFile(writeFile("a.css", "a {}"));
            ctrl.getActiveEditor()!.setLanguage("css");
            expect(spy.mock.lastCall?.[0].enabled).toBe(false);
            ctrl.editorConfiguration.toggleInlayHints("css");
            expect(spy.mock.lastCall?.[0].enabled).toBe(true);
            spy.mockRestore();
        });

        it("back at the configured value the override goes away: another language's section applies again", () => {
            const spy = appliedOptions();
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({ "[css]": { "editor.inlayHints.enabled": "off" } }),
            });
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.getActiveEditor()!.setLanguage("typescript");
            ctrl.editorConfiguration.toggleInlayHints("typescript");
            ctrl.editorConfiguration.toggleInlayHints("typescript");
            ctrl.openFile(writeFile("b.css", "b {}"));
            ctrl.getActiveEditor()!.setLanguage("css");
            expect(spy.mock.lastCall?.[0].enabled).toBe(false);
            spy.mockRestore();
        });

        it("the toggle writes nothing, a change of the key resets it, another key does not; fontStyle applies live", async () => {
            const spy = appliedOptions();
            const cfgWs = createTempWorkspace({ prefix: "diode-inlay-cfg-" });
            const paths = resolveUserDataPaths({ homedir: "/never", userDataDir: cfgWs.dir });
            const write = (content: string): void => {
                fs.mkdirSync(path.dirname(paths.settingsFile), { recursive: true });
                fs.writeFileSync(paths.settingsFile, content, "utf-8");
            };
            write("{}");
            const cfg = await loadConfiguration(
                paths,
                undefined,
                undefined,
                new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS),
            );
            const ctrl = createEditorService({ configurationService: cfg });
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.getActiveEditor()!.setLanguage("typescript");

            ctrl.editorConfiguration.toggleInlayHints("typescript");
            expect(spy.mock.lastCall?.[0].enabled).toBe(false);
            expect(fs.readFileSync(paths.settingsFile, "utf-8")).toBe("{}");

            write(`{ "diode.editor.inlayHints.fontStyle": "italic" }`);
            await cfg.reload();
            expect(spy.mock.lastCall?.[0]).toMatchObject({ enabled: false, fontStyle: "italic" });

            write(`{ "editor.inlayHints.enabled": "onUnlessPressed" }`);
            await cfg.reload();
            expect(spy.mock.lastCall?.[0].enabled).toBe(true);

            ctrl.editorConfiguration.toggleInlayHints("typescript");
            expect(spy.mock.lastCall?.[0].enabled).toBe(false);
            write(`{ "[typescript]": { "editor.inlayHints.enabled": "on" } }`);
            await cfg.reload();
            expect(spy.mock.lastCall?.[0].enabled).toBe(true);

            ctrl.dispose();
            cfgWs.dispose();
            spy.mockRestore();
        });
    });

    describe("toggleWordWrap (Alt+Z)", () => {
        it("toggles off ↔ on over the default config in all open editors", () => {
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

        it("re-enabling restores the CONFIGURED mode, not plain on", () => {
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

        it("the override survives applying config to a new editor", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.editorConfiguration.toggleWordWrap();

            ctrl.openFile(writeFile("b.ts", "b"));
            expect(ctrl.getActiveEditor()!.viewState.wordWrap).toBe("on");
        });
    });

    describe("live-reloads editor settings into already-open editors", () => {
        // Real ConfigurationService over a temp settings.json: reload() must reach ALREADY open editors.
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

            // Only a workbench key changes → the handler early-returns, the editor is left as-is.
            write(`{ "editor.tabSize": 2, "workbench.colorTheme": "Monokai" }`);
            await cfg.reload();

            expect(editor.viewState.tabSize).toBe(2);
            expect(reapplied).not.toHaveBeenCalled();

            ctrl.dispose();
            dispose();
        });
    });

    // Registry defaults layer, as in production: its absence in stubs hid a bug — `get("editor.tabSize")`
    // returned 4 on a file with any indentation, and `setIndentOptions` suppressed detection.
    describe("indentation: config with the registry defaults layer", () => {
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

        it("detects indentation from the file, not the editor.tabSize default", async () => {
            const { cfg, dispose } = await productionConfig("{}");
            const ctrl = createEditorService({ configurationService: cfg });

            ctrl.openFile(writeFile("a.ts", TWO_SPACE_FILE));

            expect(ctrl.getActiveEditor()!.viewState.tabSize).toBe(2);
            expect(ctrl.getActiveEditor()!.viewState.insertSpaces).toBe(true);

            ctrl.dispose();
            dispose();
        });

        it("detects tabs even though the editor.insertSpaces default is true", async () => {
            const { cfg, dispose } = await productionConfig("{}");
            const ctrl = createEditorService({ configurationService: cfg });

            ctrl.openFile(writeFile("b.ts", "function foo() {\n\tconst x = 1;\n}\n"));

            expect(ctrl.getActiveEditor()!.viewState.insertSpaces).toBe(false);

            ctrl.dispose();
            dispose();
        });

        it("editor.detectIndentation: false hands control back to the settings", async () => {
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
