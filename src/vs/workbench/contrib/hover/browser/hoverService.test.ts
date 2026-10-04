import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
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
import { HoverServiceDIToken, stripMarkdown } from "./hoverService.ts";

describe("stripMarkdown — плоский текст для TUI-попапа", () => {
    it("снимает fenced-ограждения, инлайн-код, жирный/курсив и ссылки", () => {
        expect(stripMarkdown("```ts\nconst a: number\n```")).toBe("const a: number");
        expect(stripMarkdown("Вызовите `compute()` **обязательно**")).toBe("Вызовите compute() обязательно");
        expect(stripMarkdown("*курсив* и __жирный__")).toBe("курсив и жирный");
        expect(stripMarkdown("Смотри [доку](https://example.com) тут")).toBe("Смотри доку тут");
        expect(stripMarkdown("экранированный \\*символ\\*")).toBe("экранированный *символ*");
    });

    it("многострочный hover tsserver'а: сигнатура + документация", () => {
        expect(stripMarkdown("```typescript\nconst answer: number\n```\nОтвет на главный вопрос.")).toBe(
            "const answer: number\nОтвет на главный вопрос.",
        );
    });

    it("обрамляющие пробелы и переводы строк срезаются", () => {
        // tsserver отдаёт документацию с хвостовым переводом строки — в рамке
        // попапа он превратился бы в пустую строку.
        expect(stripMarkdown("\n  const a: number  \n\n")).toBe("const a: number");
    });

    it("fenced-блок без перевода строки перед закрывающими кавычками", () => {
        // tsserver закрывает блок сразу за текстом — необязательный `\n?` в
        // регулярке ровно про этот случай.
        expect(stripMarkdown("```ts\nconst a: number```")).toBe("const a: number");
    });

    it("больше девяти экранированных символов подряд восстанавливаются каждый", () => {
        // Индекс прятки двузначный — регулярка возврата обязана читать `\d+`, не `\d`.
        const source = Array.from({ length: 12 }, (_, i) => `\\*${String(i)}\\*`).join(" ");
        expect(stripMarkdown(source)).toBe("*0* *1* *2* *3* *4* *5* *6* *7* *8* *9* *10* *11*");
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
    /** Ставит единственного hover-провайдера для любого документа (снимает прежних). */
    const useProvider = (provideHover: HoverProvider["provideHover"]): void => {
        for (const provider of providers) provider.dispose();
        providers = [h.container.get(LanguageFeaturesServiceDIToken).hoverProvider.register("*", { provideHover })];
    };
    /**
     * По провайдеру на hover; в ответе — в порядке аргументов. Регистрируем с
     * конца: при равном score реестр ставит более позднюю регистрацию первой.
     */
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
        // Контент одного провайдера — один блок: сигнатура + пустая строка + доки.
        const lines = component().view.linesFor(60);
        expect(lines).toContain("const answer: number");
        expect(lines).toContain("Документация ответа");
        // Фокус остался в редакторе.
        expect(group().getActiveEditor()).not.toBeNull();
    });

    it("несколько провайдеров: по блоку на каждого, между ними линия-разделитель", async () => {
        useHovers(hoverOf(["первый провайдер"]), hoverOf(["второй провайдер"]));

        await service().showHover();

        const lines = component().view.linesFor(30);
        expect(lines[0]).toBe("первый провайдер");
        expect(lines[1]).toBe("─".repeat(30));
        expect(lines[2]).toBe("второй провайдер");
    });

    it("пустой результат, пустой после стрипа и отсутствие провайдеров — попап не открывается", async () => {
        // Нет провайдеров.
        await service().showHover();
        expect(service().isOpen()).toBe(false);

        // Провайдер ответил «hover'а нет».
        useProvider(() => Promise.resolve(undefined));
        await service().showHover();
        expect(service().isOpen()).toBe(false);

        // Контент есть, но после стрипа пусто (пустой fenced-блок).
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
        // Escape не утёк в редактор и не сломал состояние: каретка на месте.
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
        // Пока ответ в полёте, попап закрыли (Escape) — seq устарел.
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
        // Якорь пропал (каретка вне видимой области) — тот же контракт, что у
        // suggest: getCaretAnchor() === null.
        editor.getCaretAnchor = () => null;

        await service().showHover();

        expect(service().isOpen()).toBe(false);
    });

    it("клик мимо попапа закрывает его (pointer-политика overlay-сессии)", async () => {
        useHovers(hoverOf(["const answer: number"]));
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        // Клик по редактору вне попапа — сессия close-on-outside обязана закрыться.
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

        // Не прямой вызов FocusTracker.fire, а настоящий путь: фокус уходит в
        // дерево Explorer, WorkbenchContextKeys ловит смену, сервис гасит попап.
        h.commands.execute("workbench.view.explorer");
        await flushMicrotasks();

        expect(service().isOpen()).toBe(false);
    });

    it("уход фокуса с редактора закрывает попап, возврат фокуса — нет", async () => {
        useHovers(hoverOf(["x"]));
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        const focusTracker = h.container.get(FocusTrackerDIToken);
        // Фокус остался в редакторе (набор в самом редакторе) — попап живёт.
        focusTracker.fire(new EditorElement(new EditorViewState(new TextDocument(""))));
        expect(service().isOpen()).toBe(true);

        focusTracker.fire(null);
        expect(service().isOpen()).toBe(false);
    });

    it("пустые блоки внутри одного hover'а не дают пустых строк в попапе", async () => {
        useHovers(hoverOf(["```ts\nconst a: number\n```", "```\n\n```", "документация"]));

        await service().showHover();

        // Пустой после стрипа блок отброшен: между сигнатурой и доками ровно
        // одна пустая строка, а не две.
        expect(component().view.linesFor(60)).toEqual(["const a: number", "", "документация"]);
    });

    it("смена активного редактора закрывает попап и переносит подписки на новый", async () => {
        useHovers(hoverOf(["x"]));
        const first = group().getActiveEditor()!;
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        group().openFile(ws.path("other.ts"));
        // Смена редактора закрыла попап.
        expect(service().isOpen()).toBe(false);

        // Правка в ПРЕЖНЕМ редакторе больше не трогает попап нового.
        await service().showHover();
        expect(service().isOpen()).toBe(true);
        first.viewState.insertText("x");
        expect(service().isOpen()).toBe(true);

        // А правка в текущем — закрывает.
        group().getActiveEditor()?.viewState.insertText("y");
        expect(service().isOpen()).toBe(false);
    });

    it("правка ниже каретки закрывает попап (текст под ним устарел)", async () => {
        useHovers(hoverOf(["x"]));
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        // Правка в конце документа: каретка не двигается, но содержимое сменилось —
        // закрытие обязано прийти от подписки на контент, не на каретку.
        const editor = group().getActiveEditor()!;
        editor.applyExternalEdits([createTextEdit(createRange(1, 0, 1, 0), "// добавили\n")], "test");
        expect(service().isOpen()).toBe(false);
    });
});
