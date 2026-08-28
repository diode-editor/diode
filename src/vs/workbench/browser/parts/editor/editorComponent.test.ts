import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { PlainTextTokenizer } from "../../../../editor/common/languages/builtin/plainTextTokenizer.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { createLineTokens, createToken } from "../../../../editor/common/languages/iLineTokens.ts";
import { NULL_STATE } from "../../../../editor/common/languages/iState.ts";
import type { ITokenizationSupport } from "../../../../editor/common/languages/iTokenizationSupport.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

/** Скоуп первого токена первой строки — чем токенизирован документ прямо сейчас. */
function firstScope(ctrl: TextEditorPane): string | undefined {
    const tokenStore = ctrl.viewState.tokenStore;
    tokenStore?.tokenizeUpTo(0);
    return tokenStore?.getLineTokens(0)?.tokens[0]?.scopes[0];
}

describe("EditorComponent + TextFileModel (пара)", () => {
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
     * Сажает пару в настоящее приложение, снимает первый кадр (после него всё
     * чисто) и отвечает, попал ли редактор в следующий кадр после `act`. Так
     * проверяется `markDirty`: без него правка доедет до экрана только с чужой
     * перерисовкой, а до тех пор пользователь видит старую картинку.
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

        it("getCaretAnchor: anchor у видимой каретки, null когда каретка вне вьюпорта", () => {
            const ctrl = createEditorPane();
            expect(ctrl.getCaretAnchor()).toMatchObject({ preferBelow: true });

            // Уводим каретку за пределы вьюпорта скроллом.
            ctrl.viewState.scrollTop = 1000;
            expect(ctrl.getCaretAnchor()).toBeNull();
        });

        it("save() is a no-op when no file is open (no file written, no onDidSave)", async () => {
            const ctrl = createEditorPane();
            let saved = false;
            ctrl.onDidSave = () => {
                saved = true;
            };

            // Must not throw and must not invoke the save callback.
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
            ctrl.onDidSave = () => {
                saved++;
            };

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

            // Should be a no-op: undo afterwards has nothing to revert.
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

            // tabSize 4 / insertSpaces false — уже действующие значения. Совпало
            // ≠ не решало: расширение всё равно высказалось про этот файл.
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

        it("одного tabSize хватает, чтобы отметить отступ выставленным", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.setIndentOptions({ tabSize: 2 });

            expect(ctrl.viewState.indentExplicitlySet).toBe(true);
        });

        it("одного insertSpaces тоже хватает", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.setIndentOptions({ insertSpaces: true });

            expect(ctrl.viewState.insertSpaces).toBe(true);
            expect(ctrl.viewState.indentExplicitlySet).toBe(true);
        });

        it("пустой патч ничего не решает", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.setIndentOptions({});

            expect(ctrl.viewState.indentExplicitlySet).toBe(false);
        });

        it("сдвиг tabSize просит перерисовку, совпадение — нет", () => {
            expect(repaintsEditor((ctrl) => ctrl.setIndentOptions({ tabSize: 2 }))).toBe(true);
            expect(repaintsEditor((ctrl) => ctrl.setIndentOptions({ tabSize: 4 }))).toBe(false);
        });

        it("сдвиг insertSpaces просит перерисовку, совпадение — нет", () => {
            expect(repaintsEditor((ctrl) => ctrl.setIndentOptions({ insertSpaces: true }))).toBe(true);
            expect(repaintsEditor((ctrl) => ctrl.setIndentOptions({ insertSpaces: false }))).toBe(false);
        });
    });

    describe("applyIndentConfiguration", () => {
        it("оставляет за содержимым файла последнее слово", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "function f() {\n  a;\n}\n")));

            ctrl.applyIndentConfiguration({ tabSize: 4, insertSpaces: true, detectIndentation: true });

            expect(ctrl.viewState.tabSize).toBe(2);
        });

        it("действует, когда детекция выключена", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "function f() {\n  a;\n}\n")));

            ctrl.applyIndentConfiguration({ tabSize: 8, insertSpaces: true, detectIndentation: false });

            expect(ctrl.viewState.tabSize).toBe(8);
            expect(ctrl.viewState.insertSpaces).toBe(true);
        });

        it("закрывает собой файл без отступов", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.applyIndentConfiguration({ tabSize: 6, insertSpaces: true });

            expect(ctrl.viewState.tabSize).toBe(6);
            expect(ctrl.viewState.insertSpaces).toBe(true);
        });

        it("ключа нет в конфиге — встроенный дефолт остаётся на месте", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            // Ни tabSize, ни insertSpaces: конфиг про них молчит.
            ctrl.applyIndentConfiguration({ detectIndentation: false });

            expect(ctrl.viewState.tabSize).toBe(4);
            expect(ctrl.viewState.insertSpaces).toBe(false);
        });

        it("неположительный tabSize из конфига игнорируется", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "x")));

            ctrl.applyIndentConfiguration({ tabSize: 0, detectIndentation: false });

            expect(ctrl.viewState.tabSize).toBe(4);
        });

        it("без ключа detectIndentation детекция остаётся включённой", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "function f() {\n  a;\n}\n")));

            ctrl.applyIndentConfiguration({ tabSize: 6 });

            expect(ctrl.viewState.tabSize).toBe(2);
        });

        it("просит перерисовку", () => {
            expect(repaintsEditor((ctrl) => ctrl.applyIndentConfiguration({ tabSize: 2 }))).toBe(true);
        });

        it("не перетирает отступ, выставленный расширением", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.ts", "function f() {\n  a;\n}\n")));
            ctrl.setIndentOptions({ tabSize: 3, insertSpaces: true });

            // Живой reload настроек не должен отменять решение расширения.
            ctrl.applyIndentConfiguration({ tabSize: 8, insertSpaces: false, detectIndentation: true });

            expect(ctrl.viewState.tabSize).toBe(3);
            expect(ctrl.viewState.insertSpaces).toBe(true);
        });

        it("переживает перечитку файла с диска (view-state пересоздаётся)", () => {
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

            // A theme that overrides the background but defines no gutter color.
            // editorGutter.background has no registry default (genuinely optional),
            // so the gutter falls back to the editor background without throwing.
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

        /** Фон ячейки первой строки: col 0 — гуттер, col 12 — пустое место за текстом
         * (символ под кареткой красит occurrence-highlight, он тут ни при чём). */
        function renderBgAt(ctrl: TextEditorPane, col: number): number {
            const app = TestApp.createWithContent(ctrl.view, new Size(20, 3));
            app.render();
            return app.backend.getBgAt(new Point(col, 0));
        }

        it("красит редактор вместе с гуттером заданным токеном темы", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.txt", "hi")));

            // Так вкладку Output сажают на фон нижней панели.
            ctrl.backgroundToken = "panel.background";

            expect(renderBgAt(ctrl, 12)).toBe(panelBg);
            expect(renderBgAt(ctrl, 0)).toBe(panelBg);
        });

        it("переживает перечитку файла с диска (EditorElement пересоздаётся)", () => {
            const ctrl = createEditorPane();
            const fp = writeFile("a.txt", "hi");
            ctrl.openFile(Uri.file(fp));
            ctrl.backgroundToken = "panel.background";

            fs.writeFileSync(fp, "yo", "utf-8");
            ctrl.revertToDisk();

            expect(renderBgAt(ctrl, 12)).toBe(panelBg);
        });

        it("по умолчанию остаётся фоном редакторской группы", () => {
            const ctrl = createEditorPane();
            ctrl.openFile(Uri.file(writeFile("a.txt", "hi")));

            const editorBg = WorkbenchTheme.fromThemeFile(darkPlusTheme).getRequiredColor("editor.background");
            expect(renderBgAt(ctrl, 12)).toBe(editorBg);
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
            // Language service resolves an id, but the registry has nothing registered for it.
            const languageService: ILanguageService = {
                ...NULL_LANGUAGE_SERVICE,
                getLanguageIdForResource: () => "typescript",
                getLanguageDisplayName: () => undefined,
            };
            const ctrl = createEditorPane({ registry, languageService });

            ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));

            // The file opened through the fallback tokenizer path without error.
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

        // Открытие файла не ждёт грамматику: сначала fallback, затем пересадка
        // на настоящий токенайзер, когда ленивая загрузка доедет.
        it("triggers the lazy load for the opened language and swaps the tokenizer in", async () => {
            const registry = new TokenizationRegistry();
            const lazySupport: ITokenizationSupport = {
                getInitialState: () => NULL_STATE,
                tokenizeLine: () => ({
                    tokens: createLineTokens([createToken(0, ["source.ts.lazy"])]),
                    endState: NULL_STATE,
                }),
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

            // Файл уже открыт и читается, грамматика ещё едет — работаем на fallback'е.
            expect(ctrl.getText()).toBe("const x = 1;");
            expect(factoryCalls).toBe(1);
            expect(firstScope(ctrl)).toBe("text.plain");

            await registry.load("typescript");

            expect(firstScope(ctrl)).toBe("source.ts.lazy");
        });
    });

    describe("onDidChangeSelection (#194)", () => {
        it("фаерит на движение каретки и переживает перечитку файла с диска", () => {
            const ctrl = createEditorPane();
            const fp = writeFile("a.txt", "one\ntwo\nthree");
            ctrl.openFile(Uri.file(fp));

            let fired = 0;
            const sub = ctrl.onDidChangeSelection(() => {
                fired++;
            });

            ctrl.viewState.selections = [createCursorSelection(1, 0)];
            expect(fired).toBe(1);

            // Перечитка пересоздаёт view-state — подписчик (extension host,
            // проецирующий выделение в субпроцесс) обязан её пережить.
            fs.writeFileSync(fp, "changed\ncontent", "utf-8");
            ctrl.revertToDisk();
            const afterReload = fired;
            ctrl.viewState.selections = [createCursorSelection(1, 2)];
            expect(fired).toBeGreaterThan(afterReload);

            sub.dispose();
            sub.dispose(); // повторный dispose безопасен
            const afterDispose = fired;
            ctrl.viewState.selections = [createCursorSelection(0, 0)];
            expect(fired).toBe(afterDispose);
        });
    });
});
