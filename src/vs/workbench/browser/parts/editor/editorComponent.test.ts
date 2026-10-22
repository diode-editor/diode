import * as fs from "node:fs";

import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodedResult, markedMetadata } from "../../../../../TestUtils/encodedTokens.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { ColorId } from "../../../../editor/common/encodedTokenAttributes.ts";
import type { ITokenizationSupport } from "../../../../editor/common/languages.ts";
import { PlainTextTokenizer } from "../../../../editor/common/languages/builtin/plainTextTokenizer.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_STATE } from "../../../../editor/common/languages/iState.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

function firstForeground(ctrl: TextEditorPane): number | undefined {
    const tokenStore = ctrl.viewState.tokenStore;
    tokenStore?.forceTokenization(0);
    return tokenStore?.getLineTokens(0)?.getForeground(0);
}

/** Marks tokens from the lazy tokenizer: a color plain text never has. */
const LAZY_FOREGROUND = 7;

describe("EditorComponent + TextFileModel (pair)", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-editorctrl-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string, content: string): string {
        return ws.writeFile(name, content);
    }

    /**
     * Checks `markDirty`: without it an edit reaches the screen only with someone else's
     * repaint.
     */
    function repaintsEditor(act: (ctrl: TextEditorPane) => void): boolean {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(writeFile(`repaint-${String(repaintCounter++)}.ts`, "x")));
        const app = TestApp.createWithContent(ctrl.view, new Size(20, 3));
        app.render();

        const renderSpy = vi.spyOn(EditorElement.prototype, "render");
        act(ctrl);
        app.render();
        const repainted = renderSpy.mock.calls.length > 0;
        renderSpy.mockRestore();
        return repainted;
    }
    let repaintCounter = 0;

    describe("fileName / save without a file", () => {
        it("has a null fileName before any file is opened", () => {
            const ctrl = createEditorPane();

            expect(ctrl.fileName).toBeNull();
            expect(ctrl.absoluteFilePath).toBeNull();
        });

        it("getCaretAnchor: anchor for a visible cursor, null when the cursor is outside the viewport", () => {
            const ctrl = createEditorPane();
            expect(ctrl.getCaretAnchor()).toMatchObject({ preferBelow: true });

            ctrl.viewState.scrollTop = 1000;
            expect(ctrl.getCaretAnchor()).toBeNull();
        });

        it("save() is a no-op when no file is open (no file written, no onDidSave event)", async () => {
            const ctrl = createEditorPane();
            let saved = false;
            ctrl.onDidSave(() => {
                saved = true;
            });

            await ctrl.save();

            expect(saved).toBe(false);
        });

        it("exposes the basename once a file is opened", () => {
            const ctrl = createEditorPane();
            const fp = writeFile("hello.ts", "x");

            ctrl.openFile(Uri.file(fp));

            expect(ctrl.fileName).toBe("hello.ts");
            expect(ctrl.absoluteFilePath).toBe(fp);
        });
    });

    describe("saveAs", () => {
        it("writes content to the new path and re-points the editor", async () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.txt", "content")));
            let saved = 0;
            ctrl.onDidSave(() => {
                saved++;
            });

            const newPath = ws.path("b.md");
            await ctrl.saveAs(newPath);

            expect(fs.readFileSync(newPath, "utf-8")).toBe("content");
            expect(ctrl.absoluteFilePath).toBe(newPath);
            expect(ctrl.fileName).toBe("b.md");
            expect(ctrl.isModified).toBe(false);
            expect(saved).toBe(1);
        });

        it("persists in-memory edits and clears the dirty flag", async () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.txt", "")));
            ctrl.viewState.insertText("edited");
            expect(ctrl.isModified).toBe(true);

            const newPath = ws.path("b.txt");
            await ctrl.saveAs(newPath);

            expect(fs.readFileSync(newPath, "utf-8")).toBe("edited");
            expect(ctrl.isModified).toBe(false);
        });

        it("re-picks the tokenizer for the new extension", async () => {
            const seen: string[] = [];
            const languageService: ILanguageService = {
                ...NULL_LANGUAGE_SERVICE,
                getLanguageIdForResource: (p) => {
                    seen.push(p);
                    return "typescript";
                },
                getLanguageDisplayName: () => undefined,
            };
            const ctrl = createEditorPane({ languageService });
            ctrl.openFile(Uri.file(writeFile("a.txt", "x")));

            const newPath = ws.path("b.ts");
            await ctrl.saveAs(newPath);

            expect(seen).toContain(newPath);
        });

        it("works for an editor that never had a file (untitled)", async () => {
            const ctrl = createEditorPane();
            ctrl.viewState.insertText("hi");

            const newPath = ws.path("new.txt");
            await ctrl.saveAs(newPath);

            expect(fs.readFileSync(newPath, "utf-8")).toBe("hi");
            expect(ctrl.absoluteFilePath).toBe(newPath);
            expect(ctrl.isModified).toBe(false);
        });
    });

    describe("pushUndo", () => {
        it("ignores an undefined element", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "abc")));

            ctrl.pushUndo(undefined);
            ctrl.undo();

            expect(ctrl.getText()).toBe("abc");
        });

        it("registers a real undo element so undo reverts the edit", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "")));

            const undoElement = ctrl.viewState.insertText("foo");
            expect(ctrl.getText()).toBe("foo");

            ctrl.pushUndo(undoElement);
            ctrl.undo();

            expect(ctrl.getText()).toBe("");

            ctrl.redo();
            expect(ctrl.getText()).toBe("foo");
        });
    });

    describe("setIndentOptions", () => {
        it("applies a new tab size and marks the indent as explicitly set", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.setIndentOptions({ tabSize: 2, insertSpaces: true });

            expect(ctrl.viewState.tabSize).toBe(2);
            expect(ctrl.viewState.insertSpaces).toBe(true);
            expect(ctrl.viewState.indentExplicitlySet).toBe(true);
        });

        it("records the override even when the patch matches current values", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            // tabSize 4 / insertSpaces false are already the effective values. Matching
            // ≠ not deciding: the extension still made a decision about this file.
            ctrl.setIndentOptions({ tabSize: 4, insertSpaces: false });

            expect(ctrl.viewState.tabSize).toBe(4);
            expect(ctrl.viewState.insertSpaces).toBe(false);
            expect(ctrl.viewState.indentExplicitlySet).toBe(true);
        });

        it("ignores a non-positive tab size", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.setIndentOptions({ tabSize: 0 });

            expect(ctrl.viewState.tabSize).toBe(4);
            expect(ctrl.viewState.indentExplicitlySet).toBe(false);
        });

        it("tabSize alone is enough to mark indentation as set", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.setIndentOptions({ tabSize: 2 });

            expect(ctrl.viewState.indentExplicitlySet).toBe(true);
        });

        it("insertSpaces alone is enough too", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.setIndentOptions({ insertSpaces: true });

            expect(ctrl.viewState.insertSpaces).toBe(true);
            expect(ctrl.viewState.indentExplicitlySet).toBe(true);
        });

        it("an empty patch decides nothing", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.setIndentOptions({});

            expect(ctrl.viewState.indentExplicitlySet).toBe(false);
        });

        it("a tabSize change requests a redraw, a match does not", () => {
            expect(
                repaintsEditor((ctrl) => {
                    ctrl.setIndentOptions({ tabSize: 2 });
                }),
            ).toBe(true);
            expect(
                repaintsEditor((ctrl) => {
                    ctrl.setIndentOptions({ tabSize: 4 });
                }),
            ).toBe(false);
        });

        it("an insertSpaces change requests a redraw, a match does not", () => {
            expect(
                repaintsEditor((ctrl) => {
                    ctrl.setIndentOptions({ insertSpaces: true });
                }),
            ).toBe(true);
            expect(
                repaintsEditor((ctrl) => {
                    ctrl.setIndentOptions({ insertSpaces: false });
                }),
            ).toBe(false);
        });
    });

    describe("tokens outside the frame", () => {
        it("an on-screen line got tokens from the store (background, catch-up) — the editor is redrawn", () => {
            // Resetting the tokenizer behind the component's back does not request a frame — the store event does.
            expect(
                repaintsEditor((ctrl) => {
                    ctrl.viewState.tokenStore?.setTokenizationSupport(new PlainTextTokenizer());
                }),
            ).toBe(false);
            expect(
                repaintsEditor((ctrl) => {
                    ctrl.viewState.tokenStore?.setTokenizationSupport(new PlainTextTokenizer());
                    ctrl.viewState.tokenStore?.forceTokenization(0);
                }),
            ).toBe(true);
        });
    });

    describe("applyIndentConfiguration", () => {
        it("leaves the final say to the file contents", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "function f() {\n  a;\n}\n")));

            ctrl.applyIndentConfiguration({ tabSize: 4, insertSpaces: true, detectIndentation: true });

            expect(ctrl.viewState.tabSize).toBe(2);
        });

        it("applies when detection is off", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "function f() {\n  a;\n}\n")));

            ctrl.applyIndentConfiguration({ tabSize: 8, insertSpaces: true, detectIndentation: false });

            expect(ctrl.viewState.tabSize).toBe(8);
            expect(ctrl.viewState.insertSpaces).toBe(true);
        });

        it("covers a file without indentation", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.applyIndentConfiguration({ tabSize: 6, insertSpaces: true });

            expect(ctrl.viewState.tabSize).toBe(6);
            expect(ctrl.viewState.insertSpaces).toBe(true);
        });

        it("key missing from the config — the built-in default stays", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.applyIndentConfiguration({ detectIndentation: false });

            expect(ctrl.viewState.tabSize).toBe(4);
            expect(ctrl.viewState.insertSpaces).toBe(false);
        });

        it("a non-positive tabSize from the config is ignored", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.applyIndentConfiguration({ tabSize: 0, detectIndentation: false });

            expect(ctrl.viewState.tabSize).toBe(4);
        });

        it("without the detectIndentation key detection stays on", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "function f() {\n  a;\n}\n")));

            ctrl.applyIndentConfiguration({ tabSize: 6 });

            expect(ctrl.viewState.tabSize).toBe(2);
        });

        it("requests a redraw", () => {
            expect(
                repaintsEditor((ctrl) => {
                    ctrl.applyIndentConfiguration({ tabSize: 2 });
                }),
            ).toBe(true);
        });

        it("does not overwrite indentation set by an extension", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "function f() {\n  a;\n}\n")));
            ctrl.setIndentOptions({ tabSize: 3, insertSpaces: true });

            ctrl.applyIndentConfiguration({ tabSize: 8, insertSpaces: false, detectIndentation: true });

            expect(ctrl.viewState.tabSize).toBe(3);
            expect(ctrl.viewState.insertSpaces).toBe(true);
        });

        it("survives a file reload from disk", () => {
            const ctrl = createEditorPane();
            const fp = writeFile("a.ts", "x");
            ctrl.openFile(Uri.file(fp));
            ctrl.applyIndentConfiguration({ tabSize: 6, insertSpaces: true, detectIndentation: false });

            fs.writeFileSync(fp, "function f() {\n  a;\n}\n", "utf-8");
            ctrl.revertToDisk();

            expect(ctrl.viewState.tabSize).toBe(6);
            expect(ctrl.viewState.insertSpaces).toBe(true);
        });
    });

    describe("setCursorSurroundingLines", () => {
        it("normalizes fractional/negative values to a non-negative integer", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.setCursorSurroundingLines(3.9);
            expect(ctrl.viewState.cursorSurroundingLines).toBe(3);

            ctrl.setCursorSurroundingLines(-5);
            expect(ctrl.viewState.cursorSurroundingLines).toBe(0);
        });

        it("is a no-op when the normalized value matches the current one", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.setCursorSurroundingLines(2);
            expect(ctrl.viewState.cursorSurroundingLines).toBe(2);

            // 2.4 normalizes back to 2 → early return, value unchanged.
            ctrl.setCursorSurroundingLines(2.4);
            expect(ctrl.viewState.cursorSurroundingLines).toBe(2);
        });
    });

    describe("theme with missing editor gutter colors", () => {
        it("falls back to the editor background when gutter colors are absent", () => {
            const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
            const ctrl = createEditorPane({ themeService });
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            // editorGutter.background has no registry default — the gutter falls back to the editor background.
            const sparseTheme = WorkbenchTheme.fromThemeFile({
                name: "sparse",
                type: "dark",
                colors: { "editor.background": "#112233" },
            });

            expect(() => {
                themeService.setTheme(sparseTheme);
            }).not.toThrow();
        });
    });

    describe("backgroundToken", () => {
        const panelBg = WorkbenchTheme.fromThemeFile(darkPlusTheme).getRequiredColor("panel.background");

        /** Background of a first-row cell: col 0 is the gutter, col 12 is empty space past the text
         * (the character under the cursor is painted by occurrence-highlight, which is unrelated here). */
        function renderBgAt(ctrl: TextEditorPane, col: number): number {
            const app = TestApp.createWithContent(ctrl.view, new Size(20, 3));
            app.render();
            return app.backend.getBgAt(new Point(col, 0));
        }

        it("paints the editor together with the gutter with the given theme token", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.txt", "hi")));

            ctrl.backgroundToken = "panel.background";

            expect(renderBgAt(ctrl, 12)).toBe(panelBg);
            expect(renderBgAt(ctrl, 0)).toBe(panelBg);
        });

        it("survives a file reload from disk", () => {
            const ctrl = createEditorPane();
            const fp = writeFile("a.txt", "hi");
            ctrl.openFile(Uri.file(fp));
            ctrl.backgroundToken = "panel.background";

            fs.writeFileSync(fp, "yo", "utf-8");
            ctrl.revertToDisk();

            expect(renderBgAt(ctrl, 12)).toBe(panelBg);
        });

        it("defaults to the editor group background", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.txt", "hi")));

            const editorBg = WorkbenchTheme.fromThemeFile(darkPlusTheme).getRequiredColor("editor.background");
            expect(renderBgAt(ctrl, 12)).toBe(editorBg);
        });
    });

    describe("setScrollbarMarkers", () => {
        function renderView(ctrl: TextEditorPane, width: number): TestApp {
            const app = TestApp.createWithContent(ctrl.view, new Size(width, 10));
            app.render();
            return app;
        }

        function openLongFile(): TextEditorPane {
            const ctrl = createEditorPane();
            const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
            ctrl.openFile(Uri.file(writeFile("a.txt", text)));
            return ctrl;
        }

        it("defaults to auto: inside the scrollbar on a narrow editor, a column of its own on a wide one", () => {
            const narrow = openLongFile();
            renderView(narrow, 40);
            expect(narrow.view.getChild().layoutSize.width).toBe(39);

            const wide = openLongFile();
            renderView(wide, 100);
            expect(wide.view.getChild().layoutSize.width).toBe(98);
        });

        it("outside always takes a marker column, off keeps the classic scrollbar", () => {
            const outside = openLongFile();
            outside.setScrollbarMarkers("outside");
            renderView(outside, 40);
            expect(outside.view.getChild().layoutSize.width).toBe(38);

            const off = openLongFile();
            off.setScrollbarMarkers("off");
            const app = renderView(off, 100);
            expect(off.view.getChild().layoutSize.width).toBe(99);
            expect(app.backend.getTextAt(new Point(99, 9), 1)).toBe("░");
        });

        it("inside keeps the marks in the scrollbar column on a wide editor too", () => {
            const ctrl = openLongFile();
            ctrl.setScrollbarMarkers("inside");
            // Same value again is a no-op (covers the early return).
            ctrl.setScrollbarMarkers("inside");
            renderView(ctrl, 100);
            expect(ctrl.view.getChild().layoutSize.width).toBe(99);
        });
    });

    describe("occurrence highlight", () => {
        // Occurrence-highlight background from darkPlus (#474747).
        const OCCURRENCE_BG = packRgb(71, 71, 71);

        function renderRow0Bg(ctrl: TextEditorPane, col: number): number {
            const app = TestApp.createWithContent(ctrl.view, new Size(20, 3));
            app.render();
            return app.backend.getBgAt(new Point(col, 0));
        }

        it("highlights the word under the cursor using the theme's wordHighlight color", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.txt", "foo foo")));
            ctrl.viewState.selections = [createCursorSelection(0, 0)];

            // gutterWidth = 6 (2 pad + 1 digit + 3 fold margin); content col 0 is the first "foo".
            expect(renderRow0Bg(ctrl, 6)).toBe(OCCURRENCE_BG);
        });

        it("stops highlighting once disabled via setOccurrenceHighlightEnabled", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.txt", "foo foo")));
            ctrl.viewState.selections = [createCursorSelection(0, 0)];

            ctrl.setOccurrenceHighlightEnabled(false);
            // Toggling to the same value again is a no-op (covers the early return).
            ctrl.setOccurrenceHighlightEnabled(false);

            expect(renderRow0Bg(ctrl, 4)).not.toBe(OCCURRENCE_BG);
        });
    });

    describe("pickTokenizer fallback", () => {
        it("uses a plain-text tokenizer when the registry has no support for the language", () => {
            const registry = new TokenizationRegistry();
            const languageService: ILanguageService = {
                ...NULL_LANGUAGE_SERVICE,
                getLanguageIdForResource: () => "typescript",
                getLanguageDisplayName: () => undefined,
            };
            const ctrl = createEditorPane({ registry, languageService });

            ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));

            expect(ctrl.getText()).toBe("const x = 1;");
        });

        it("uses the registered tokenizer when one is available", () => {
            const registry = new TokenizationRegistry();
            registry.register("typescript", new PlainTextTokenizer());
            const languageService: ILanguageService = {
                ...NULL_LANGUAGE_SERVICE,
                getLanguageIdForResource: () => "typescript",
                getLanguageDisplayName: () => undefined,
            };
            const ctrl = createEditorPane({ registry, languageService });

            ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));

            expect(ctrl.getText()).toBe("const x = 1;");
        });

        it("triggers the lazy load for the opened language and swaps the tokenizer in", async () => {
            const registry = new TokenizationRegistry();
            const lazySupport: ITokenizationSupport = {
                getInitialState: () => NULL_STATE,
                tokenizeEncoded: () => encodedResult([[0, markedMetadata(LAZY_FOREGROUND)]], NULL_STATE),
            };
            let factoryCalls = 0;
            registry.registerLazy("typescript", async () => {
                factoryCalls++;
                return lazySupport;
            });
            const languageService: ILanguageService = {
                ...NULL_LANGUAGE_SERVICE,
                getLanguageIdForResource: () => "typescript",
                getLanguageDisplayName: () => undefined,
            };
            const ctrl = createEditorPane({ registry, languageService });

            ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));

            expect(ctrl.getText()).toBe("const x = 1;");
            expect(factoryCalls).toBe(1);
            expect(firstForeground(ctrl)).toBe(ColorId.DefaultForeground);

            await registry.load("typescript");

            expect(firstForeground(ctrl)).toBe(LAZY_FOREGROUND);
        });
    });

    describe("onDidChangeSelection (#194)", () => {
        it("fires on cursor movement and survives a file reload from disk", () => {
            const ctrl = createEditorPane();
            const fp = writeFile("a.txt", "one\ntwo\nthree");
            ctrl.openFile(Uri.file(fp));

            let fired = 0;
            const sub = ctrl.onDidChangeSelection(() => {
                fired++;
            });

            ctrl.viewState.selections = [createCursorSelection(1, 0)];
            expect(fired).toBe(1);

            fs.writeFileSync(fp, "changed", "utf-8");
            ctrl.revertToDisk();
            const afterReload = fired;
            expect(afterReload).toBe(2);
            expect(ctrl.viewState.selections).toEqual([createCursorSelection(0, 0)]);
            ctrl.viewState.selections = [createCursorSelection(1, 2)];
            expect(fired).toBeGreaterThan(afterReload);

            sub.dispose();
            sub.dispose(); // a repeated dispose is safe
            const afterDispose = fired;
            ctrl.viewState.selections = [createCursorSelection(0, 0)];
            expect(fired).toBe(afterDispose);
        });
    });
});
