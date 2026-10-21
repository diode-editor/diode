import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { HoverProvider, ICoreHover } from "../../../../editor/common/languages/iHoverSource.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { FocusTrackerDIToken } from "../../../services/focus/browser/focusTracker.ts";

import { HoverComponentDIToken } from "./hoverComponent.ts";
import { HoverServiceDIToken, splitMarkdownSections, stripMarkdown } from "./hoverService.ts";

describe("stripMarkdown — плоский текст для TUI-попапа", () => {
    it("снимает fenced-ограждения, инлайн-код, жирный/курсив и ссылки", () => {
        expect(stripMarkdown("```ts\nconst a: number\n```")).toBe("const a: number");
        expect(stripMarkdown("Вызовите `compute()` **обязательно**")).toBe("Вызовите compute() обязательно");
        expect(stripMarkdown("*курсив* и __жирный__")).toBe("курсив и жирный");
        expect(stripMarkdown("Смотри [доку](https://example.com) тут")).toBe("Смотри доку тут");
        expect(stripMarkdown("экранированный \\*символ\\*")).toBe("экранированный *символ*");
    });

    it("`_курсив_` снимается только на границе слова — snake_case не трогается", () => {
        // terraform-ls marks the type like this: "`var.region` _string_".
        expect(stripMarkdown("`var.region`\n_string_")).toBe("var.region\nstring");
        expect(stripMarkdown("тип (_строка_), см. aws_instance_type")).toBe("тип (строка), см. aws_instance_type");
        expect(stripMarkdown("a_b_c и _x_y")).toBe("a_b_c и _x_y");
        expect(stripMarkdown("_ не курсив _ и __")).toBe("_ не курсив _ и __");
        expect(stripMarkdown("_слово_ы")).toBe("_слово_ы");
        expect(stripMarkdown("_a_")).toBe("a");
        expect(stripMarkdown("экранированный \\_символ\\_")).toBe("экранированный _символ_");
    });

    it("многострочный hover tsserver'а: сигнатура + документация", () => {
        expect(stripMarkdown("```typescript\nconst answer: number\n```\nОтвет на главный вопрос.")).toBe(
            "const answer: number\nОтвет на главный вопрос.",
        );
    });

    it("обрамляющие пробелы и переводы строк срезаются", () => {
        // tsserver returns documentation with a trailing newline; in the popup
        // frame it would turn into an empty line.
        expect(stripMarkdown("\n  const a: number  \n\n")).toBe("const a: number");
    });

    it("fenced-блок без перевода строки перед закрывающими кавычками", () => {
        // tsserver closes the block right after the text; the optional `\n?` in
        // the regex is exactly for this case.
        expect(stripMarkdown("```ts\nconst a: number```")).toBe("const a: number");
    });

    it("больше девяти экранированных символов подряд восстанавливаются каждый", () => {
        // The hiding index is two-digit: the restore regex must read `\d+`, not `\d`.
        const source = Array.from({ length: 12 }, (_, i) => `\\*${String(i)}\\*`).join(" ");
        expect(stripMarkdown(source)).toBe("*0* *1* *2* *3* *4* *5* *6* *7* *8* *9* *10* *11*");
    });
});

describe("splitMarkdownSections — секции по thematic break", () => {
    it("`---`, `***`, `___` (с пробелами и отступом до 3) режут на секции; пустые остаются", () => {
        expect(splitMarkdownSections("a\n\n---\n\nb\n\n***\n\nc\n\n_ _ _\n\nd")).toEqual(["a", "b", "c", "d"]);
        expect(splitMarkdownSections("---\n\n   - - - -  \n\nтолько текст\n\n---")).toEqual([
            "",
            "",
            "только текст",
            "",
        ]);
    });

    it("не разделитель: две черты, смесь символов, отступ 4, символ после", () => {
        expect(splitMarkdownSections("a\n\n--\n\n-*-\n\n    ---\n\n---x")).toEqual([
            "a\n\n--\n\n-*-\n\n    ---\n\n---x",
        ]);
    });

    it("`---` внутри fenced-блока — содержимое; закрывающее ограждение — того же вида и не короче", () => {
        expect(splitMarkdownSections("```yaml\n---\nkey: 1\n```\n\n---\n\nдока")).toEqual(["---\nkey: 1", "дока"]);
        // Inside a ````-block neither ``` nor ~~~~ closes it: one split, after the block.
        // (stripMarkdown strips the ```` themselves imprecisely, a known limitation; here we only check the split.)
        const sections = splitMarkdownSections("````\n```\n---\n~~~~\n````\n---\nx");
        expect(sections).toHaveLength(2);
        expect(sections[1]).toBe("x");
    });

    it("`---` под строкой абзаца — setext-заголовок: линия выпадает, `***` под абзацем — разделитель", () => {
        expect(splitMarkdownSections("Заголовок\n---\nтекст")).toEqual(["Заголовок\nтекст"]);
        expect(splitMarkdownSections("абзац\n***\nтекст")).toEqual(["абзац", "текст"]);
        // Below a separator and below a whitespace-only line there's no paragraph, so `---` is a separator again.
        expect(splitMarkdownSections("абзац\n***\n---\nтекст")).toEqual(["абзац", "", "текст"]);
        expect(splitMarkdownSections("абзац\n   \n---\nтекст")).toEqual(["абзац", "текст"]);
        expect(splitMarkdownSections("Заголовок\n  ---\nтекст")).toEqual(["Заголовок\nтекст"]);
    });

    it("секции стрипаются по отдельности", () => {
        expect(splitMarkdownSections("**a**\n\n---\n\n[b](https://x)")).toEqual(["a", "b"]);
    });
});

describe("HoverService — показ и закрытие попапа", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-hover-",
            files: {
                "main.ts": "const answer = compute();\nconst other = 1;\n",
                "other.ts": "export const other = 1;\n",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const group = () => h.container.get(EditorServiceDIToken);
    const service = () => h.container.get(HoverServiceDIToken);
    const component = () => h.container.get(HoverComponentDIToken);

    const hoverOf = (contents: string[]): ICoreHover => ({ contents });

    let providers: IDisposable[] = [];
    const useProvider = (provideHover: HoverProvider["provideHover"]): void => {
        for (const provider of providers) provider.dispose();
        providers = [h.container.get(LanguageFeaturesServiceDIToken).hoverProvider.register("*", { provideHover })];
    };
    /** Register in reverse: with equal score the registry puts the later registration first. */
    const useHovers = (...hovers: ICoreHover[]): void => {
        for (const provider of providers) provider.dispose();
        const registry = h.container.get(LanguageFeaturesServiceDIToken).hoverProvider;
        providers = hovers
            .toReversed()
            .map((hover) => registry.register("*", { provideHover: () => Promise.resolve(hover) }));
    };

    it("показывает попап с очищенным от markdown контентом у каретки", async () => {
        useHovers(hoverOf(["```ts\nconst answer: number\n```", "Документация **ответа**"]));

        const keys = new ContextKeyService();
        service().updateContextKeys(keys);
        expect(keys.get("editorHoverVisible")).toBe(false);

        await service().showHover();

        expect(service().isOpen()).toBe(true);
        service().updateContextKeys(keys);
        expect(keys.get("editorHoverVisible")).toBe(true);
        const lines = component().view.linesFor(60);
        expect(lines).toContain("const answer: number");
        expect(lines).toContain("Документация ответа");
        expect(group().getActiveEditor()).not.toBeNull();
    });

    it("закрытие попапа отменяет запрос и у провайдера", async () => {
        const tokens: ICancellationToken[] = [];
        useProvider((_request, token) => {
            tokens.push(token);
            return new Promise(() => undefined);
        });

        void service().showHover();
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([false]);

        service().close();
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([true]);
    });

    it("несколько провайдеров: по блоку на каждого, между ними линия-разделитель", async () => {
        useHovers(hoverOf(["первый провайдер"]), hoverOf(["второй провайдер"]));

        await service().showHover();

        const lines = component().view.linesFor(30);
        expect(lines[0]).toBe("первый провайдер");
        expect(lines[1]).toBe("─".repeat(30));
        expect(lines[2]).toBe("второй провайдер");
    });

    it("разделитель с краю контента отделяет его от соседнего; без разделителя контенты в одном блоке", async () => {
        useHovers(hoverOf(["сигнатура\n\n---", "дока", "ещё", "***\n\nссылка"]));

        await service().showHover();

        expect(component().view.linesFor(20)).toEqual([
            "сигнатура",
            "─".repeat(20),
            "дока",
            "",
            "ещё",
            "─".repeat(20),
            "ссылка",
        ]);
    });

    it("thematic break внутри hover'а (gopls) рисуется на кадре линией, как граница блоков", async () => {
        useHovers(
            hoverOf([
                "```go\nfunc greet.Hello(name string) string\n```\n\n---\n\nHello greets.\n\n\n---\n\n[`greet.Hello` on pkg.go.dev](https://pkg.go.dev/x/greet#Hello)",
            ]),
        );

        await service().showHover();
        h.testApp.render();

        const frame = h.testApp.backend.screenToString();
        expect(frame).not.toContain("---");
        const rows = frame.split("\n");
        const at = rows.findIndex((row) => row.includes("func greet.Hello(name string) string"));
        expect(rows[at + 1]).toMatch(/│ ─{20,} │/u);
        expect(rows[at + 2]).toContain("│ Hello greets.");
        expect(rows[at + 3]).toMatch(/│ ─{20,} │/u);
        expect(rows[at + 4]).toContain("│ greet.Hello on pkg.go.dev");
    });

    it("пустой результат, пустой после стрипа и отсутствие провайдеров — попап не открывается", async () => {
        // No providers.
        await service().showHover();
        expect(service().isOpen()).toBe(false);

        // The provider answered "no hover".
        useProvider(() => Promise.resolve(undefined));
        await service().showHover();
        expect(service().isOpen()).toBe(false);

        // There is content, but it's empty after stripping (an empty fenced block).
        useHovers(hoverOf(["```ts\n\n```"]));
        await service().showHover();
        expect(service().isOpen()).toBe(false);
    });

    it("провайдер чужого языка не спрашивается вовсе", async () => {
        let asked = false;
        const registry = h.container.get(LanguageFeaturesServiceDIToken).hoverProvider;
        providers = [
            registry.register("python", {
                provideHover: () => {
                    asked = true;
                    return Promise.resolve(hoverOf(["питон"]));
                },
            }),
        ];

        await service().showHover();

        expect(asked).toBe(false);
        expect(service().isOpen()).toBe(false);
    });

    it("порядок блоков — по score селектора: точный язык выше `*`, хоть и зарегистрирован раньше", async () => {
        const registry = h.container.get(LanguageFeaturesServiceDIToken).hoverProvider;
        const languageId = group().getActiveEditor()!.languageId;
        providers = [
            registry.register(languageId, { provideHover: () => Promise.resolve(hoverOf(["точный"])) }),
            registry.register("*", { provideHover: () => Promise.resolve(hoverOf(["любой"])) }),
        ];

        await service().showHover();

        const lines = component().view.linesFor(30);
        expect(lines[0]).toBe("точный");
        expect(lines[2]).toBe("любой");
    });

    it("сбойный провайдер не роняет остальных", async () => {
        const registry = h.container.get(LanguageFeaturesServiceDIToken).hoverProvider;
        providers = [
            registry.register("*", { provideHover: () => Promise.resolve(hoverOf(["живой"])) }),
            registry.register("*", { provideHover: () => Promise.reject(new Error("boom")) }),
        ];

        await service().showHover();

        expect(component().view.linesFor(30)).toEqual(["живой"]);
    });

    it("запрос несёт версию документа и позицию каретки, но не текст", async () => {
        const seen: { uri?: string; line?: number; character?: number; versionId?: number } = {};
        useProvider((request) => {
            Object.assign(seen, request);
            return Promise.resolve(hoverOf(["x"]));
        });
        group().getActiveEditor()?.goToPosition(1, 6);

        await service().showHover();

        expect(seen).toMatchObject({ line: 1, character: 6 });
        expect(seen.versionId).toBe(group().getActiveEditor()?.model.document.versionId);
        expect(seen).not.toHaveProperty("text");
    });

    it("Ctrl+K Ctrl+U открывает попап, Escape закрывает — фокус остаётся в редакторе", async () => {
        useHovers(hoverOf(["const answer: number"]));

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Ctrl+U");
        await flushMicrotasks();
        expect(service().isOpen()).toBe(true);

        h.testApp.sendKey("Escape");
        expect(service().isOpen()).toBe(false);
        expect(group().getActiveEditor()?.viewState.selections[0].active).toMatchObject({ line: 0, character: 0 });
    });

    it("движение каретки и правка закрывают попап", async () => {
        useHovers(hoverOf(["x"]));

        await service().showHover();
        expect(service().isOpen()).toBe(true);
        h.testApp.sendKey("ArrowRight");
        expect(service().isOpen()).toBe(false);

        await service().showHover();
        expect(service().isOpen()).toBe(true);
        h.testApp.sendKey("a");
        expect(service().isOpen()).toBe(false);
    });

    it("устаревший ответ не переоткрывает закрытый попап", async () => {
        let release: (hover: ICoreHover) => void = () => undefined;
        useProvider(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                }),
        );

        const pending = service().showHover();
        // While the response is in flight the popup was closed (Escape), so seq is stale.
        service().close();
        release(hoverOf(["опоздавший"]));
        await pending;

        expect(service().isOpen()).toBe(false);
    });

    it("повторный showHover при открытом попапе обновляет контент и пере-анкорит сессию", async () => {
        let text = "первая версия";
        useProvider(() => Promise.resolve(hoverOf([text])));

        await service().showHover();
        expect(service().isOpen()).toBe(true);

        text = "вторая версия";
        await service().showHover();

        expect(service().isOpen()).toBe(true);
        expect(component().view.linesFor(60)).toContain("вторая версия");
    });

    it("нет активного редактора — источник не вызывается", async () => {
        let called = false;
        useProvider(() => {
            called = true;
            return Promise.resolve(hoverOf(["x"]));
        });
        h.commands.execute("workbench.action.closeActiveEditor");
        expect(group().getActiveEditor()).toBeNull();

        await service().showHover();

        expect(called).toBe(false);
        expect(service().isOpen()).toBe(false);
    });

    it("каретка ушла из вьюпорта за время запроса — попап не открывается", async () => {
        useHovers(hoverOf(["x"]));
        const editor = group().getActiveEditor()!;
        // The anchor is gone (cursor outside the visible area): same contract as
        // suggest: getCaretAnchor() === null.
        editor.getCaretAnchor = () => null;

        await service().showHover();

        expect(service().isOpen()).toBe(false);
    });

    it("клик мимо попапа закрывает его (pointer-политика overlay-сессии)", async () => {
        useHovers(hoverOf(["const answer: number"]));
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        const click = (action: "press" | "release"): MouseToken => ({
            kind: "mouse",
            button: "left",
            action,
            x: 2,
            y: 20,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            raw: "",
        });
        h.testApp.backend.simulateMouse(click("press"));
        h.testApp.backend.simulateMouse(click("release"));

        expect(service().isOpen()).toBe(false);
    });

    it("настоящий уход фокуса в другой виджет закрывает попап", async () => {
        useHovers(hoverOf(["const answer: number"]));
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        // Not a direct FocusTracker.fire call but the real path: focus moves into the
        // Explorer tree, WorkbenchContextKeys catches the change, the service dismisses the popup.
        h.commands.execute("workbench.view.explorer");
        await flushMicrotasks();

        expect(service().isOpen()).toBe(false);
    });

    it("уход фокуса с редактора закрывает попап, возврат фокуса — нет", async () => {
        useHovers(hoverOf(["x"]));
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        const focusTracker = h.container.get(FocusTrackerDIToken);
        // Focus stayed in the editor (typing in the editor itself), so the popup lives.
        focusTracker.fire(new EditorElement(new EditorViewState(new TextDocument(""))));
        expect(service().isOpen()).toBe(true);

        focusTracker.fire(null);
        expect(service().isOpen()).toBe(false);
    });

    it("пустые блоки внутри одного hover'а не дают пустых строк в попапе", async () => {
        useHovers(hoverOf(["```ts\nconst a: number\n```", "```\n\n```", "документация"]));

        await service().showHover();

        // The block that's empty after stripping is dropped: exactly one empty line
        // between the signature and the docs, not two.
        expect(component().view.linesFor(60)).toEqual(["const a: number", "", "документация"]);
    });

    it("смена активного редактора закрывает попап и переносит подписки на новый", async () => {
        useHovers(hoverOf(["x"]));
        const first = group().getActiveEditor()!;
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        group().openFile(ws.path("other.ts"));
        expect(service().isOpen()).toBe(false);

        // An edit in the PREVIOUS editor no longer affects the new one's popup.
        await service().showHover();
        expect(service().isOpen()).toBe(true);
        first.viewState.insertText("x");
        expect(service().isOpen()).toBe(true);

        group().getActiveEditor()?.viewState.insertText("y");
        expect(service().isOpen()).toBe(false);
    });

    it("правка ниже каретки закрывает попап (текст под ним устарел)", async () => {
        useHovers(hoverOf(["x"]));
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        // An edit below the cursor: the cursor stays, but the content changed.
        const editor = group().getActiveEditor()!;
        editor.applyExternalEdits([createTextEdit(createRange(1, 0, 1, 0), "// добавили\n")], "test");
        expect(service().isOpen()).toBe(false);
    });
});
