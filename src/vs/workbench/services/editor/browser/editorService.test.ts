import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { createLoggerSpy } from "../../../../../TestUtils/themeExtensionFixture.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { PlainTextTokenizer } from "../../../../editor/common/languages/builtin/plainTextTokenizer.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
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
        logService?: ILogService;
    } = {},
): EditorService {
    const themeService = overrides.themeService ?? new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    return new EditorService(
        themeService,
        overrides.registry ?? new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        overrides.languageService ?? NULL_LANGUAGE_SERVICE,
        overrides.configurationService ?? createTestConfigurationService(),
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        overrides.logService ?? NULL_LOG_SERVICE,
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

describe("EditorService", () => {
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

    describe("openFile", () => {
        it("opens a file and creates a tab", () => {
            const ctrl = createEditorService();
            const fp = writeFile("hello.ts", "const x = 1;");

            ctrl.openFile(fp);

            expect(ctrl.editorGroups.activeGroup.editorCount).toBe(1);
            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("hello.ts");
        });

        it("opens multiple files", () => {
            const ctrl = createEditorService();
            const fp1 = writeFile("a.ts", "a");
            const fp2 = writeFile("b.ts", "b");

            ctrl.openFile(fp1);
            ctrl.openFile(fp2);

            expect(ctrl.editorGroups.activeGroup.editorCount).toBe(2);
            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(1);
        });

        it("switches to existing tab if file already open", () => {
            const ctrl = createEditorService();
            const fp = writeFile("a.ts", "a");

            ctrl.openFile(fp);
            ctrl.openFile(writeFile("b.ts", "b"));
            ctrl.openFile(fp);

            expect(ctrl.editorGroups.activeGroup.editorCount).toBe(2);
            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(0);
        });

        it("opens two files with the same name from different directories as separate tabs", () => {
            const ctrl = createEditorService();
            const fp1 = writeFile(path.join("a", "index.ts"), "a");
            const fp2 = writeFile(path.join("b", "index.ts"), "b");

            ctrl.openFile(fp1);
            ctrl.openFile(fp2);

            expect(ctrl.editorGroups.activeGroup.editorCount).toBe(2);
            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(1);
        });
    });

    describe("newUntitled", () => {
        it("opens a path-less buffer named Untitled-1, incrementing per buffer", () => {
            const ctrl = createEditorService();

            ctrl.newUntitled();
            expect(ctrl.editorGroups.activeGroup.editorCount).toBe(1);
            expect(ctrl.getActiveEditor()?.absoluteFilePath).toBeNull();
            expect(ctrl.displayName(ctrl.getActiveEditor()!)).toBe("Untitled-1");

            ctrl.newUntitled();
            expect(ctrl.getEditors().map((e) => ctrl.displayName(e))).toEqual(["Untitled-1", "Untitled-2"]);
        });

        it("does not reuse a number after an untitled buffer is closed", () => {
            const ctrl = createEditorService();

            ctrl.newUntitled();
            ctrl.newUntitled();
            ctrl.editorGroups.activeGroup.closeTab(0);
            ctrl.newUntitled();

            expect(ctrl.getEditors().map((e) => ctrl.displayName(e))).toEqual(["Untitled-2", "Untitled-3"]);
        });

        it("suggestedSaveName: label + buffer language extension (plaintext → .txt)", () => {
            const ctrl = createEditorService({
                languageService: {
                    ...NULL_LANGUAGE_SERVICE,
                    getExtensionForLanguage: (id) => (id === "plaintext" ? ".txt" : undefined),
                },
            });
            ctrl.newUntitled();

            expect(ctrl.suggestedSaveName(ctrl.getActiveEditor()!)).toBe("Untitled-1.txt");
        });

        it("suggestedSaveName follows the buffer's language change, not a hardcoded default", () => {
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

        it("suggestedSaveName: a language without an extension → a name without an extension", () => {
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

            ctrl.editorGroups.activeGroup.activateTab(0);

            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });

        it("ignores out-of-range index", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));

            ctrl.editorGroups.activeGroup.activateTab(5);

            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(0);
        });
    });

    describe("closeTab", () => {
        it("closes the only tab", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));

            ctrl.editorGroups.activeGroup.closeTab(0);

            expect(ctrl.editorGroups.activeGroup.editorCount).toBe(0);
            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(-1);
            expect(ctrl.getActiveEditor()).toBeNull();
        });

        it("closes middle tab and adjusts activeIndex", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));
            ctrl.openFile(writeFile("c.ts", "c"));
            ctrl.editorGroups.activeGroup.activateTab(1);

            ctrl.editorGroups.activeGroup.closeTab(1);

            expect(ctrl.editorGroups.activeGroup.editorCount).toBe(2);
            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });

        it("closes last tab and activates previous", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));

            ctrl.editorGroups.activeGroup.closeTab(1);

            expect(ctrl.editorGroups.activeGroup.editorCount).toBe(1);
            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });

        it("closes first tab when second is active", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));
            ctrl.editorGroups.activeGroup.activateTab(1);

            ctrl.editorGroups.activeGroup.closeTab(0);

            expect(ctrl.editorGroups.activeGroup.editorCount).toBe(1);
            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(0);
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
            return ctrl.editorGroups.activeGroup.getMruOrder().map((e) => ctrl.displayName(e));
        }

        it("Ctrl+Tab activates the previously used editor, not the next tab by position", () => {
            const ctrl = createEditorService();
            openThree(ctrl);

            // Active is c (last). MRU order is c, b, a → Ctrl+Tab picks b, not (wrap to) a.
            ctrl.editorGroups.activeGroup.cycleMru(1);

            expect(ctrl.getActiveEditor()?.fileName).toBe("b.ts");
            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(1);
        });

        it("stepping deeper walks the frozen MRU stack instead of toggling two editors", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            ctrl.editorGroups.activeGroup.cycleMru(1); // → b
            expect(ctrl.getActiveEditor()?.fileName).toBe("b.ts");
            ctrl.editorGroups.activeGroup.cycleMru(1); // → a (deeper, not back to c)
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
            ctrl.editorGroups.activeGroup.cycleMru(1); // → c (wrap around)
            expect(ctrl.getActiveEditor()?.fileName).toBe("c.ts");
        });

        it("Ctrl+Shift+Tab steps toward more recent editors", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a, active c

            // From the top of the stack, going up wraps to the least-recent editor.
            ctrl.editorGroups.activeGroup.cycleMru(-1);

            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });

        it("MRU order reflects the actual usage history, not tab position", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            ctrl.editorGroups.activeGroup.activateTab(0); // click a → MRU: a, c, b
            expect(mruNames(ctrl)).toEqual(["a.ts", "c.ts", "b.ts"]);

            // Now Ctrl+Tab from a goes to c (the next most-recent), not b (next tab).
            ctrl.editorGroups.activeGroup.cycleMru(1);
            expect(ctrl.getActiveEditor()?.fileName).toBe("c.ts");
        });

        it("a fresh cycle re-snapshots the MRU order after an edit commits the selection", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            ctrl.editorGroups.activeGroup.cycleMru(1); // → b (not yet committed to MRU front)
            // A normal activation (e.g. click) ends the cycle and commits.
            ctrl.editorGroups.activeGroup.activateTab(1); // stay on b, but now commit → MRU: b, c, a

            ctrl.editorGroups.activeGroup.cycleMru(1); // fresh cycle from b → next most-recent is c
            expect(ctrl.getActiveEditor()?.fileName).toBe("c.ts");
        });

        it("releasing Ctrl commits the selection so quick presses toggle the two newest", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            // Press-release Ctrl+Tab: one step, then commit on release.
            ctrl.editorGroups.activeGroup.cycleMru(1); // → b
            ctrl.editorGroups.activeGroup.endMruCycle(); // release Ctrl → commit → MRU: b, c, a
            expect(ctrl.getActiveEditor()?.fileName).toBe("b.ts");
            expect(mruNames(ctrl)).toEqual(["b.ts", "c.ts", "a.ts"]);

            // Next press-release toggles back to c, not deeper to a.
            ctrl.editorGroups.activeGroup.cycleMru(1); // → c
            ctrl.editorGroups.activeGroup.endMruCycle(); // MRU: c, b, a
            expect(ctrl.getActiveEditor()?.fileName).toBe("c.ts");

            ctrl.editorGroups.activeGroup.cycleMru(1); // → b again (toggle)
            ctrl.editorGroups.activeGroup.endMruCycle();
            expect(ctrl.getActiveEditor()?.fileName).toBe("b.ts");
        });

        it("keeps stepping deeper while Ctrl is held (no endMruCycle between steps)", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            // Ctrl held: repeated Tab without a release walks the frozen stack.
            ctrl.editorGroups.activeGroup.cycleMru(1); // → b
            ctrl.editorGroups.activeGroup.cycleMru(1); // → a
            ctrl.editorGroups.activeGroup.endMruCycle(); // release Ctrl → commit a
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
            expect(mruNames(ctrl)).toEqual(["a.ts", "c.ts", "b.ts"]);
        });

        it("endMruCycle is a no-op when no series is in progress", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            ctrl.editorGroups.activeGroup.endMruCycle(); // nothing to commit
            expect(mruNames(ctrl)).toEqual(["c.ts", "b.ts", "a.ts"]);
            expect(ctrl.getActiveEditor()?.fileName).toBe("c.ts");
        });

        it("is a no-op with fewer than two editors", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));

            ctrl.editorGroups.activeGroup.cycleMru(1);

            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });

        it("keeps the MRU stack consistent after closing a tab", () => {
            const ctrl = createEditorService();
            openThree(ctrl); // MRU: c, b, a

            ctrl.editorGroups.activeGroup.closeTab(2); // close active c → b becomes active
            expect(ctrl.getActiveEditor()?.fileName).toBe("b.ts");
            expect(mruNames(ctrl)).toEqual(["b.ts", "a.ts"]);

            ctrl.editorGroups.activeGroup.cycleMru(1);
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

    describe("collectDirty (shutdown participant)", () => {
        it("returns only unsaved editors, skips clean ones", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("clean.ts", "a"));
            ctrl.openFile(writeFile("dirty.ts", "b"));
            ctrl.getActiveEditor()!.setEol(EndOfLine.CRLF);

            const items = ctrl.collectDirty();

            expect(items.map((i) => i.name)).toEqual(["dirty.ts"]);
        });

        it("isStillDirty turns false after the tab closes; save clears isModified", async () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a\nb"));
            const editor = ctrl.getActiveEditor()!;
            editor.setEol(EndOfLine.CRLF);

            const [item] = ctrl.collectDirty();
            expect(item.isStillDirty()).toBe(true);

            expect(await item.save()).toBe(true);
            expect(editor.isModified).toBe(false);

            ctrl.editorGroups.activeGroup.closeTab(0);
            expect(item.isStillDirty()).toBe(false);
        });

        it("save overwrites a file changed on disk externally: the Save choice is not lost", async () => {
            const ctrl = createEditorService();
            const file = writeFile("a.ts", "a\nb");
            ctrl.openFile(file);
            ctrl.getActiveEditor()!.setEol(EndOfLine.CRLF);
            fs.writeFileSync(file, "changed outside");

            const [item] = ctrl.collectDirty();

            expect(await item.save()).toBe(true);
            expect(fs.readFileSync(file, "utf8")).toBe("a\r\nb");
        });
    });

    describe("saveAll (before running a task)", () => {
        it("saves unsaved files once per document, leaves clean ones alone", async () => {
            const ctrl = createEditorService();
            const dirty = writeFile("dirty.ts", "a\nb");
            const clean = writeFile("clean.ts", "c");
            ctrl.openFile(dirty);
            ctrl.getActiveEditor()!.setEol(EndOfLine.CRLF);
            ctrl.openFile(clean);

            await expect(ctrl.saveAll()).resolves.toBe(true);

            expect(fs.readFileSync(dirty, "utf8")).toBe("a\r\nb");
            expect(fs.readFileSync(clean, "utf8")).toBe("c");
            expect(ctrl.collectDirty()).toStrictEqual([]);
        });

        it("does not overwrite a file changed on disk", async () => {
            const ctrl = createEditorService();
            const file = writeFile("a.ts", "a\nb");
            ctrl.openFile(file);
            ctrl.getActiveEditor()!.setEol(EndOfLine.CRLF);
            fs.writeFileSync(file, "changed outside");

            await expect(ctrl.saveAll()).resolves.toBe(false);

            expect(fs.readFileSync(file, "utf8")).toBe("changed outside");
            expect(ctrl.collectDirty()).toHaveLength(1);
        });

        it("a write failure yields false and a logged error, other files are still saved", async () => {
            const logger = createLoggerSpy();
            const ctrl = createEditorService({ logService: { createLogger: () => logger } as unknown as ILogService });
            const locked = writeFile("locked/a.ts", "a\nb");
            const other = writeFile("b.ts", "c\nd");
            ctrl.openFile(locked);
            ctrl.getActiveEditor()!.setEol(EndOfLine.CRLF);
            ctrl.openFile(other);
            ctrl.getActiveEditor()!.setEol(EndOfLine.CRLF);
            fs.chmodSync(path.dirname(locked), 0o500);
            try {
                await expect(ctrl.saveAll()).resolves.toBe(false);
            } finally {
                fs.chmodSync(path.dirname(locked), 0o700);
            }

            expect(fs.readFileSync(locked, "utf8")).toBe("a\nb");
            expect(fs.readFileSync(other, "utf8")).toBe("c\r\nd");
            expect(logger.error).toHaveBeenCalledTimes(1);
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining(`cannot save ${Uri.file(locked).toString()}: `),
            );
        });

        it("an untitled buffer is skipped; with includeUntitled it is not saved, so false", async () => {
            const ctrl = createEditorService();
            const file = writeFile("a.ts", "a\nb");
            ctrl.newUntitled();
            ctrl.getActiveEditor()!.setEol(EndOfLine.CRLF);
            ctrl.openFile(file);
            ctrl.getActiveEditor()!.setEol(EndOfLine.CRLF);

            await expect(ctrl.saveAll({ includeUntitled: true })).resolves.toBe(false);
            expect(fs.readFileSync(file, "utf8")).toBe("a\r\nb");
            await expect(ctrl.saveAll()).resolves.toBe(true);
            await expect(ctrl.saveAll({ includeUntitled: false })).resolves.toBe(true);
            expect(ctrl.collectDirty()).toHaveLength(1);
        });
    });

    describe("save (extensions' workspace.save)", () => {
        it("saves the resource's open document, even a clean one, and returns its resource", async () => {
            const ctrl = createEditorService();
            const file = writeFile("a.ts", "a\nb");
            ctrl.openFile(file);
            ctrl.getActiveEditor()!.setEol(EndOfLine.CRLF);
            ctrl.openFile(writeFile("b.ts", "c"));
            ctrl.getActiveEditor()!.setEol(EndOfLine.CRLF);
            const second = Uri.file(path.join(tmpDir, "b.ts"));
            expect((await ctrl.save(second))?.toString()).toBe(second.toString());
            expect(fs.readFileSync(file, "utf8")).toBe("a\nb");

            const saved = await ctrl.save(Uri.file(file));

            expect(saved?.toString()).toBe(Uri.file(file).toString());
            expect(fs.readFileSync(file, "utf8")).toBe("a\r\nb");
            fs.unlinkSync(file);
            await expect(ctrl.save(Uri.file(file))).resolves.toBeDefined();
            expect(fs.readFileSync(file, "utf8")).toBe("a\r\nb");
        });

        it("not open, untitled, disk conflict or write failure: undefined", async () => {
            const ctrl = createEditorService();
            await expect(ctrl.save(Uri.file(path.join(tmpDir, "none.ts")))).resolves.toBeUndefined();
            // Open files don't stand in for the requested resource.
            const open = writeFile("open.ts", "a\nb");
            ctrl.openFile(open);
            ctrl.getActiveEditor()!.setEol(EndOfLine.CRLF);
            await expect(ctrl.save(Uri.file(path.join(tmpDir, "none.ts")))).resolves.toBeUndefined();
            expect(fs.readFileSync(open, "utf8")).toBe("a\nb");

            ctrl.newUntitled();
            await expect(ctrl.save(ctrl.getActiveEditor()!.uri)).resolves.toBeUndefined();

            const changed = writeFile("changed.ts", "a");
            ctrl.openFile(changed);
            fs.writeFileSync(changed, "changed outside");
            await expect(ctrl.save(Uri.file(changed))).resolves.toBeUndefined();
            expect(fs.readFileSync(changed, "utf8")).toBe("changed outside");

            const locked = writeFile("locked/a.ts", "a");
            ctrl.openFile(locked);
            fs.chmodSync(path.dirname(locked), 0o500);
            try {
                await expect(ctrl.save(Uri.file(locked))).resolves.toBeUndefined();
            } finally {
                fs.chmodSync(path.dirname(locked), 0o700);
            }
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

            expect(ctrl.editorGroups.activeGroup.editorCount).toBe(1);
            expect(ctrl.getActiveEditor()?.getText()).toBe("const x = 1;");
        });
    });

    describe("activateTab without focus", () => {
        it("switches tabs without moving focus when focus: false", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));

            ctrl.editorGroups.activeGroup.activateTab(0, { focus: false });

            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(0);
            expect(ctrl.getActiveEditor()?.fileName).toBe("a.ts");
        });
    });

    describe("closeTab edge cases", () => {
        it("ignores an out-of-range index", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));

            ctrl.editorGroups.activeGroup.closeTab(99);

            expect(ctrl.editorGroups.activeGroup.editorCount).toBe(1);
            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(0);
        });

        it("closing a tab after the active one keeps the active index", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts", "a"));
            ctrl.openFile(writeFile("b.ts", "b"));
            ctrl.openFile(writeFile("c.ts", "c"));
            ctrl.editorGroups.activeGroup.activateTab(0);

            // index 2 is after the active index 0 → active index is untouched.
            ctrl.editorGroups.activeGroup.closeTab(2);

            expect(ctrl.editorGroups.activeGroup.editorCount).toBe(2);
            expect(ctrl.editorGroups.activeGroup.activeIndex).toBe(0);
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

    describe("save participant & onEditorSaved", () => {
        it("saveParticipant is visible to existing and future editors (the pipeline is built at save time)", async () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.txt", "x"));

            const saved: string[] = [];
            const participant = (snapshot: { uri: string }): Promise<never[]> => {
                saved.push(snapshot.uri);
                return Promise.resolve([]);
            };
            // Assigned AFTER opening: the host connects later than the first file.
            ctrl.saveParticipant = participant;
            expect(ctrl.saveParticipant).toBe(participant);

            await ctrl.getActiveEditor()?.save();
            const bPath = writeFile("b.txt", "y");
            ctrl.openFile(bPath);
            await ctrl.getActiveEditor()?.save();

            expect(saved).toHaveLength(2);
            expect(saved[1]).toBe(Uri.file(bPath).toString());
        });

        it("saving a model without a tab (diff side) also redraws the strip", async () => {
            const ctrl = createEditorService();
            const ref = ctrl.textFileModels.acquire(Uri.file(writeFile("side.txt", "x")));
            let changes = 0;
            ctrl.onDidChangeEditors(() => changes++);

            await ref.model.save();

            expect(changes).toBe(1);
            ref.dispose();
        });

        it("onEditorSaved fires on save and unsubscribes via dispose", async () => {
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
            sub.dispose(); // a second dispose is a no-op (idx === -1)
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
            ctrl.newUntitled(); // no path on disk, so not in the snapshot
            ctrl.openFile(b);
            expect(ctrl.getOpenFilePaths()).toEqual([a, b]);
        });
    });

    describe("onDidChangeActiveEditorSelection (#194)", () => {
        it("follows the active tab and is removed on dispose", () => {
            const ctrl = createEditorService();
            const a = writeFile("a.ts", "one\ntwo");
            const b = writeFile("b.ts", "three\nfour");
            ctrl.openFile(a);

            const seen: string[] = [];
            const sub = ctrl.onDidChangeActiveEditorSelection((editor) => seen.push(editor.uri.toString()));

            ctrl.getActiveEditor()!.viewState.selections = [createCursorSelection(1, 0)];
            expect(seen).toEqual([Uri.file(a).toString()]);

            // A second tab opened: the subscription must move to it by itself,
            // otherwise the host would project the previous editor's selection.
            ctrl.openFile(b);
            ctrl.getActiveEditor()!.viewState.selections = [createCursorSelection(1, 1)];
            expect(seen).toEqual([Uri.file(a).toString(), Uri.file(b).toString()]);

            sub.dispose();
            sub.dispose(); // a second dispose is a no-op (idx === -1)
            ctrl.getActiveEditor()!.viewState.selections = [createCursorSelection(0, 0)];
            expect(seen).toHaveLength(2);
        });
    });
});
