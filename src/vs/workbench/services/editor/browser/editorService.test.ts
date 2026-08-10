import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import * as fs from "node:fs";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { PlainTextTokenizer } from "../../../../editor/common/languages/builtin/plainTextTokenizer.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { loadConfiguration } from "../../../../platform/configuration/node/configurationService.ts";
import { resolveUserDataPaths } from "../../../../platform/environment/node/userDataPaths.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

function createEditorService(
    overrides: {
        registry?: TokenizationRegistry;
        languageService?: ILanguageService;
        configurationService?: IConfigurationService;
        themeService?: ThemeService;
    } = {},
): EditorService {
    const themeService = overrides.themeService ?? new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    return new EditorService(
        themeService,
        overrides.registry ?? new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        overrides.languageService ?? NULL_LANGUAGE_SERVICE,
        overrides.configurationService ?? NULL_CONFIGURATION_SERVICE,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
    );
}

/** Minimal IConfigurationService that serves a fixed key/value map. */
function stubConfigurationService(values: Record<string, unknown>): IConfigurationService {
    return {
        ...NULL_CONFIGURATION_SERVICE,
        get<T>(key: string, defaultValue?: T): T | undefined {
            return key in values ? (values[key] as T) : defaultValue;
        },
    };
}

describe("EditorService", () => {
    let tmpDir: string;
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-test-" });
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

    describe("openFile", () => {
        it("opens a file and creates a tab", () => {
            const ctrl = createEditorService();
            const fp = writeFile("hello.ts", "const x = 1;");

            ctrl.openFile(fp);

            expect(ctrl.editorCount).toBe(1);
            expect(ctrl.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("hello.ts");
        });

        it("opens multiple files", () => {
            const ctrl = createEditorService();
            const fp1 = writeFile("a.ts", "a");
            const fp2 = writeFile("b.ts", "b");

            ctrl.openFile(fp1);
            ctrl.openFile(fp2);

            expect(ctrl.editorCount).toBe(2);
            expect(ctrl.activeIndex).toBe(1);
        });

        it("switches to existing tab if file already open", () => {
            const ctrl = createEditorService();
            const fp = writeFile("a.ts", "a");

            ctrl.openFile(fp);
            ctrl.openFile(writeFile("b.ts", "b"));
            ctrl.openFile(fp);

            expect(ctrl.editorCount).toBe(2);
            expect(ctrl.activeIndex).toBe(0);
        });

        it("opens two files with the same name from different directories as separate tabs", () => {
            const ctrl = createEditorService();
            const fp1 = writeFile(path.join("a", "index.ts"), "a");
            const fp2 = writeFile(path.join("b", "index.ts"), "b");

            ctrl.openFile(fp1);
            ctrl.openFile(fp2);

            expect(ctrl.editorCount).toBe(2);
            expect(ctrl.activeIndex).toBe(1);
        });
    });

    describe("newUntitled", () => {
        it("opens a path-less buffer named Untitled-1, incrementing per buffer", () => {
            const ctrl = createEditorService();

            ctrl.newUntitled();
            expect(ctrl.editorCount).toBe(1);
            expect(ctrl.getActiveEditor()?.absoluteFilePath).toBeNull();
            expect(ctrl.displayName(ctrl.getActiveEditor()!)).toBe("Untitled-1");

            ctrl.newUntitled();
            expect(ctrl.getEditors().map((e) => ctrl.displayName(e))).toEqual(["Untitled-1", "Untitled-2"]);
        });

        it("does not reuse a number after an untitled buffer is closed", () => {
            const ctrl = createEditorService();

            ctrl.newUntitled();
            ctrl.newUntitled();
            ctrl.closeTab(0);
            ctrl.newUntitled();

            expect(ctrl.getEditors().map((e) => ctrl.displayName(e))).toEqual(["Untitled-2", "Untitled-3"]);
        });

        it("suggestedSaveName: метка + расширение языка буфера (plaintext → .txt)", () => {
            const ctrl = createEditorService({
                languageService: {
                    ...NULL_LANGUAGE_SERVICE,
                    getExtensionForLanguage: (id) => (id === "plaintext" ? ".txt" : undefined),
                },
            });
            ctrl.newUntitled();

            expect(ctrl.suggestedSaveName(ctrl.getActiveEditor()!)).toBe("Untitled-1.txt");
        });

        it("suggestedSaveName следует за сменой языка буфера, а не за зашитым дефолтом", () => {
            const ctrl = createEditorService({
                languageService: {
                    ...NULL_LANGUAGE_SERVICE,
                    getExtensionForLanguage: (id) => (id === "typescript" ? ".ts" : ".txt"),
                },
            });
            ctrl.newUntitled();
            const editor = ctrl.getActiveEditor()!;
            expect(ctrl.suggestedSaveName(editor)).toBe("Untitled-1.txt");

            editor.setLanguage("typescript");
            expect(ctrl.suggestedSaveName(editor)).toBe("Untitled-1.ts");
        });

        it("suggestedSaveName: язык без расширения → имя без расширения", () => {
            const ctrl = createEditorService(); // NULL_LANGUAGE_SERVICE → undefined
            ctrl.newUntitled();

            expect(ctrl.suggestedSaveName(ctrl.getActiveEditor()!)).toBe("Untitled-1");
        });

        it("displayName becomes the basename after the buffer is saved to a path", async () => {
            const ctrl = createEditorService();

            ctrl.newUntitled();
            await ctrl.getActiveEditor()!.saveAs(path.join(tmpDir, "note.txt"));

            expect(ctrl.displayName(ctrl.getActiveEditor()!)).toBe("note.txt");
        });
    });

    describe("activateTab", () => {
        it("switches to the specified tab", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));

            ctrl.activateTab(0);

            expect(ctrl.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });

        it("ignores out-of-range index", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));

            ctrl.activateTab(5);

            expect(ctrl.activeIndex).toBe(0);
        });
    });

    describe("closeTab", () => {
        it("closes the only tab", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));

            ctrl.closeTab(0);

            expect(ctrl.editorCount).toBe(0);
            expect(ctrl.activeIndex).toBe(-1);
            expect(ctrl.getActiveEditor()).toBeNull();
        });

        it("closes middle tab and adjusts activeIndex", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));
            ctrl.openFile(writeFile("c.ts", "c"));
            ctrl.activateTab(1);

            ctrl.closeTab(1);

            expect(ctrl.editorCount).toBe(2);
            expect(ctrl.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });

        it("closes last tab and activates previous", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));

            ctrl.closeTab(1);

            expect(ctrl.editorCount).toBe(1);
            expect(ctrl.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });

        it("closes first tab when second is active", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));
            ctrl.activateTab(1);

            ctrl.closeTab(0);

            expect(ctrl.editorCount).toBe(1);
            expect(ctrl.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("b.ts");
        });
    });

    describe("MRU cycling (cycleMru)", () => {
        function openThree(ctrl: EditorService): void {
            ctrl.openFile(writeFile("a.ts", "a")); // index 0
            ctrl.openFile(writeFile("b.ts", "b")); // index 1
            ctrl.openFile(writeFile("c.ts", "c")); // index 2, active; MRU: c, b, a
        }

        function mruNames(ctrl: EditorService): (string | null)[] {
            return ctrl.getMruOrder().map((e) => ctrl.displayName(e));
        }

        it("Ctrl+Tab activates the previously used editor, not the next tab by position", () => {
            const ctrl = createEditorService();
            openThree(ctrl);

            // Active is c (last). MRU order is c, b, a → Ctrl+Tab picks b, not (wrap to) a.
            ctrl.cycleMru(1);

            expect(ctrl.getActiveEditor()?.fileName).toBe("b.ts");
            expect(ctrl.activeIndex).toBe(1);
        });

        it("stepping deeper walks the frozen MRU stack instead of toggling two editors", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            ctrl.cycleMru(1); // → b
            expect(ctrl.getActiveEditor()?.fileName).toBe("b.ts");
            ctrl.cycleMru(1); // → a (deeper, not back to c)
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
            ctrl.cycleMru(1); // → c (wrap around)
            expect(ctrl.getActiveEditor()?.fileName).toBe("c.ts");
        });

        it("Ctrl+Shift+Tab steps toward more recent editors", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a, active c

            // From the top of the stack, going up wraps to the least-recent editor.
            ctrl.cycleMru(-1);

            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });

        it("MRU order reflects the actual usage history, not tab position", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            ctrl.activateTab(0); // click a → MRU: a, c, b
            expect(mruNames(ctrl)).toEqual(["a.ts", "c.ts", "b.ts"]);

            // Now Ctrl+Tab from a goes to c (the next most-recent), not b (next tab).
            ctrl.cycleMru(1);
            expect(ctrl.getActiveEditor()?.fileName).toBe("c.ts");
        });

        it("a fresh cycle re-snapshots the MRU order after an edit commits the selection", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            ctrl.cycleMru(1); // → b (not yet committed to MRU front)
            // A normal activation (e.g. click) ends the cycle and commits.
            ctrl.activateTab(1); // stay on b, but now commit → MRU: b, c, a

            ctrl.cycleMru(1); // fresh cycle from b → next most-recent is c
            expect(ctrl.getActiveEditor()?.fileName).toBe("c.ts");
        });

        it("releasing Ctrl commits the selection so quick presses toggle the two newest", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            // Press-release Ctrl+Tab: one step, then commit on release.
            ctrl.cycleMru(1); // → b
            ctrl.endMruCycle(); // release Ctrl → commit → MRU: b, c, a
            expect(ctrl.getActiveEditor()?.fileName).toBe("b.ts");
            expect(mruNames(ctrl)).toEqual(["b.ts", "c.ts", "a.ts"]);

            // Next press-release toggles back to c, not deeper to a.
            ctrl.cycleMru(1); // → c
            ctrl.endMruCycle(); // MRU: c, b, a
            expect(ctrl.getActiveEditor()?.fileName).toBe("c.ts");

            ctrl.cycleMru(1); // → b again (toggle)
            ctrl.endMruCycle();
            expect(ctrl.getActiveEditor()?.fileName).toBe("b.ts");
        });

        it("keeps stepping deeper while Ctrl is held (no endMruCycle between steps)", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            // Ctrl held: repeated Tab without a release walks the frozen stack.
            ctrl.cycleMru(1); // → b
            ctrl.cycleMru(1); // → a
            ctrl.endMruCycle(); // release Ctrl → commit a
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
            expect(mruNames(ctrl)).toEqual(["a.ts", "c.ts", "b.ts"]);
        });

        it("endMruCycle is a no-op when no series is in progress", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            ctrl.endMruCycle(); // nothing to commit
            expect(mruNames(ctrl)).toEqual(["c.ts", "b.ts", "a.ts"]);
            expect(ctrl.getActiveEditor()?.fileName).toBe("c.ts");
        });

        it("is a no-op with fewer than two editors", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));

            ctrl.cycleMru(1);

            expect(ctrl.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });

        it("keeps the MRU stack consistent after closing a tab", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            ctrl.closeTab(2); // close active c → b becomes active
            expect(ctrl.getActiveEditor()?.fileName).toBe("b.ts");
            expect(mruNames(ctrl)).toEqual(["b.ts", "a.ts"]);

            // Cycling now only sees the two remaining editors.
            ctrl.cycleMru(1);
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });

        it("reopening an already-open file promotes it to the MRU front", () => {
            const ctrl = createEditorService();
            const fpA = writeFile("a.ts", "a");
            ctrl.openFile(fpA);
            ctrl.openFile(writeFile("b.ts", "b")); // MRU: b, a
            ctrl.openFile(fpA); // re-focus a → MRU: a, b

            expect(mruNames(ctrl)).toEqual(["a.ts", "b.ts"]);
        });
    });

    describe("collectDirty (участник shutdown)", () => {
        it("возвращает только несохранённые редакторы, чистые пропускает", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("clean.ts", "a"));
            ctrl.openFile(writeFile("dirty.ts", "b"));
            ctrl.getActiveEditor()!.setEol(EndOfLine.CRLF);

            const items = ctrl.collectDirty();

            expect(items.map((i) => i.name)).toEqual(["dirty.ts"]);
        });

        it("isStillDirty гаснет после закрытия вкладки; save снимает isModified", async () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a\nb"));
            const editor = ctrl.getActiveEditor()!;
            editor.setEol(EndOfLine.CRLF);

            const [item] = ctrl.collectDirty();
            expect(item.isStillDirty()).toBe(true);

            await item.save();
            expect(editor.isModified).toBe(false);

            ctrl.closeTab(0);
            expect(item.isStillDirty()).toBe(false);
        });
    });

    describe("getEditor", () => {
        it("returns null for out-of-range indices", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));

            expect(ctrl.getEditor(-1)).toBeNull();
            expect(ctrl.getEditor(1)).toBeNull();
            expect(ctrl.getEditor(0)).not.toBeNull();
        });
    });

    describe("activate", () => {
        it("activates every open editor without throwing", async () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));

            await expect(ctrl.activate()).resolves.toBeUndefined();
        });
    });

    describe("applies configuration to new editors", () => {
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

        it("seeds cursorSurroundingLines from the configuration service", () => {
            const ctrl = createEditorService({
                configurationService: stubConfigurationService({
                    "editor.cursorSurroundingLines": 5,
                }),
            });
            ctrl.openFile(writeFile("a.ts", "const x = 1;"));

            expect(ctrl.getActiveEditor()!.viewState.cursorSurroundingLines).toBe(5);
        });
    });

    describe("live-reloads editor settings into already-open editors", () => {
        // Real ConfigurationService over a temp settings.json — editing the file and
        // calling reload() emits onDidChangeConfiguration, which the service must apply
        // to editors that are ALREADY open (not just newly created ones).
        async function realConfig(initial: string) {
            const cfgWs = createTempWorkspace({ prefix: "vexx-es-cfg-" });
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

            // Only a workbench key changes → affectsConfiguration("editor") is false,
            // the service's handler early-returns and the editor is left as-is.
            write(`{ "editor.tabSize": 2, "workbench.colorTheme": "Monokai" }`);
            await cfg.reload();

            expect(editor.viewState.tabSize).toBe(2);

            ctrl.dispose();
            dispose();
        });
    });

    describe("language detection", () => {
        it("picks the registered tokenizer when the language service resolves a language id", () => {
            const registry = new TokenizationRegistry();
            registry.register("typescript", new PlainTextTokenizer());
            const languageService: ILanguageService = {
                ...NULL_LANGUAGE_SERVICE,
                getLanguageIdForResource: () => "typescript",
                getLanguageDisplayName: () => undefined,
            };
            const ctrl = createEditorService({ registry, languageService });

            ctrl.openFile(writeFile("a.ts", "const x = 1;"));

            // The file opened successfully through the language-resolved path.
            expect(ctrl.editorCount).toBe(1);
            expect(ctrl.getActiveEditor()?.getText()).toBe("const x = 1;");
        });
    });

    describe("activateTab without focus", () => {
        it("switches tabs without moving focus when focus: false", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));

            ctrl.activateTab(0, { focus: false });

            expect(ctrl.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });
    });

    describe("closeTab edge cases", () => {
        it("ignores an out-of-range index", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));

            ctrl.closeTab(99);

            expect(ctrl.editorCount).toBe(1);
            expect(ctrl.activeIndex).toBe(0);
        });

        it("closing a tab after the active one keeps the active index", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));
            ctrl.openFile(writeFile("c.ts", "c"));
            ctrl.activateTab(0);

            // index 2 is after the active index 0 → active index is untouched.
            ctrl.closeTab(2);

            expect(ctrl.editorCount).toBe(2);
            expect(ctrl.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });
    });

    describe("onActiveEditorChanged subscription", () => {
        it("fires the listener and stops after dispose", () => {
            const ctrl = createEditorService();

            const seen: (string | null)[] = [];
            const subscription = ctrl.onActiveEditorChanged((editor) => {
                seen.push(editor?.fileName ?? null);
            });

            ctrl.openFile(writeFile("a.ts", "a"));
            expect(seen).toEqual(["a.ts"]);

            subscription.dispose();
            // Disposing again is a no-op (listener already removed).
            subscription.dispose();

            ctrl.openFile(writeFile("b.ts", "b"));
            expect(seen).toEqual(["a.ts"]);
        });
    });

    describe("onDidChangeEditors subscription", () => {
        it("fires on tab-affecting changes and stops after dispose", () => {
            const ctrl = createEditorService();

            let fired = 0;
            const subscription = ctrl.onDidChangeEditors(() => {
                fired++;
            });

            ctrl.openFile(writeFile("a.ts", "a"));
            expect(fired).toBeGreaterThan(0);

            const seen = fired;
            subscription.dispose();
            // Disposing again is a no-op (listener already removed).
            subscription.dispose();

            ctrl.openFile(writeFile("b.ts", "b"));
            expect(fired).toBe(seen);
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

    describe("save participant & onEditorSaved", () => {
        it("раздаёт saveParticipant существующим и будущим редакторам", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.txt", "x"));

            const participant = (): Promise<never[]> => Promise.resolve([]);
            ctrl.saveParticipant = participant;
            expect(ctrl.saveParticipant).toBe(participant);
            expect(ctrl.getActiveEditor()?.saveParticipant).toBe(participant);

            // Новый редактор получает участника при открытии.
            ctrl.openFile(writeFile("b.txt", "y"));
            expect(ctrl.getEditor(1)?.saveParticipant).toBe(participant);
        });

        it("onEditorSaved стреляет при сохранении и отписывается через dispose", async () => {
            const ctrl = createEditorService({
                languageService: {
                    ...NULL_LANGUAGE_SERVICE,
                    getLanguageIdForResource: (f) => (f.endsWith(".ts") ? "typescript" : undefined),
                },
            });
            const fp = writeFile("a.ts", "x");
            ctrl.openFile(fp);

            const seen: { uri: string; languageId: string }[] = [];
            const sub = ctrl.onEditorSaved((m) => seen.push(m));
            await ctrl.getActiveEditor()?.save();
            expect(seen).toEqual([{ uri: Uri.file(fp).toString(), languageId: "typescript" }]);

            sub.dispose();
            sub.dispose(); // повторный dispose — no-op (idx === -1)
            await ctrl.getActiveEditor()?.save();
            expect(seen).toHaveLength(1);
        });
    });

    describe("getOpenFilePaths", () => {
        it("returns file paths in tab order and skips untitled buffers", () => {
            const ctrl = createEditorService();
            const a = writeFile("a.ts", "A");
            const b = writeFile("b.ts", "B");
            ctrl.openFile(a);
            ctrl.newUntitled(); // без пути на диске — в снимок не попадает
            ctrl.openFile(b);
            expect(ctrl.getOpenFilePaths()).toEqual([a, b]);
        });
    });

    describe("onDidChangeActiveEditorSelection (#194)", () => {
        it("следует за активной вкладкой и снимается по dispose", () => {
            const ctrl = createEditorService();
            const a = writeFile("a.ts", "one\ntwo");
            const b = writeFile("b.ts", "three\nfour");
            ctrl.openFile(a);

            const seen: string[] = [];
            const sub = ctrl.onDidChangeActiveEditorSelection((editor) => seen.push(editor.uri.toString()));

            ctrl.getActiveEditor()!.viewState.selections = [createCursorSelection(1, 0)];
            expect(seen).toEqual([Uri.file(a).toString()]);

            // Открыли вторую вкладку — подписка обязана переехать на неё сама,
            // иначе host проецировал бы выделение прошлого редактора.
            ctrl.openFile(b);
            ctrl.getActiveEditor()!.viewState.selections = [createCursorSelection(1, 1)];
            expect(seen).toEqual([Uri.file(a).toString(), Uri.file(b).toString()]);

            sub.dispose();
            sub.dispose(); // повторный dispose — no-op (idx === -1)
            ctrl.getActiveEditor()!.viewState.selections = [createCursorSelection(0, 0)];
            expect(seen).toHaveLength(2);
        });
    });
});
