import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ICoreHover } from "../../../../editor/common/languages/iHoverSource.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

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

    it("показывает попап с очищенным от markdown контентом у каретки", async () => {
        group().hoverSource = () =>
            Promise.resolve([hoverOf(["```ts\nconst answer: number\n```", "Документация **ответа**"])]);

        await service().showHover();

        expect(service().isOpen()).toBe(true);
        // Контент одного провайдера — один блок: сигнатура + пустая строка + доки.
        const lines = component().view.linesFor(60);
        expect(lines).toContain("const answer: number");
        expect(lines).toContain("Документация ответа");
        // Фокус остался в редакторе.
        expect(group().getActiveEditor()).not.toBeNull();
    });

    it("несколько провайдеров: по блоку на каждого, между ними линия-разделитель", async () => {
        group().hoverSource = () => Promise.resolve([hoverOf(["первый провайдер"]), hoverOf(["второй провайдер"])]);

        await service().showHover();

        const lines = component().view.linesFor(30);
        expect(lines[0]).toBe("первый провайдер");
        expect(lines[1]).toBe("─".repeat(30));
        expect(lines[2]).toBe("второй провайдер");
    });

    it("пустой результат, пустой после стрипа и отсутствие источника — попап не открывается", async () => {
        // Нет источника.
        await service().showHover();
        expect(service().isOpen()).toBe(false);

        // Пустой результат.
        group().hoverSource = () => Promise.resolve([]);
        await service().showHover();
        expect(service().isOpen()).toBe(false);

        // Контент есть, но после стрипа пусто (пустой fenced-блок).
        group().hoverSource = () => Promise.resolve([hoverOf(["```ts\n\n```"])]);
        await service().showHover();
        expect(service().isOpen()).toBe(false);
    });

    it("запрос несёт снапшот и позицию каретки", async () => {
        const seen: { uri?: string; line?: number; character?: number; text?: string } = {};
        group().hoverSource = (request) => {
            Object.assign(seen, request);
            return Promise.resolve([hoverOf(["x"])]);
        };
        group().getActiveEditor()?.goToPosition(1, 6);

        await service().showHover();

        expect(seen).toMatchObject({ line: 1, character: 6 });
        expect(seen.text).toContain("const answer");
    });

    it("Ctrl+K Ctrl+X открывает попап, Escape закрывает — фокус остаётся в редакторе", async () => {
        group().hoverSource = () => Promise.resolve([hoverOf(["const answer: number"])]);

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Ctrl+X");
        await flushMicrotasks();
        expect(service().isOpen()).toBe(true);

        h.testApp.sendKey("Escape");
        expect(service().isOpen()).toBe(false);
        // Escape не утёк в редактор и не сломал состояние: каретка на месте.
        expect(group().getActiveEditor()?.viewState.selections[0].active).toMatchObject({ line: 0, character: 0 });
    });

    it("движение каретки и правка закрывают попап", async () => {
        group().hoverSource = () => Promise.resolve([hoverOf(["x"])]);

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
        let release: (hovers: ICoreHover[]) => void = () => undefined;
        group().hoverSource = () =>
            new Promise((resolve) => {
                release = resolve;
            });

        const pending = service().showHover();
        // Пока ответ в полёте, попап закрыли (Escape) — seq устарел.
        service().close();
        release([hoverOf(["опоздавший"])]);
        await pending;

        expect(service().isOpen()).toBe(false);
    });

    it("повторный showHover при открытом попапе обновляет контент и пере-анкорит сессию", async () => {
        let text = "первая версия";
        group().hoverSource = () => Promise.resolve([hoverOf([text])]);

        await service().showHover();
        expect(service().isOpen()).toBe(true);

        text = "вторая версия";
        await service().showHover();

        expect(service().isOpen()).toBe(true);
        expect(component().view.linesFor(60)).toContain("вторая версия");
    });

    it("нет активного редактора — источник не вызывается", async () => {
        let called = false;
        group().hoverSource = () => {
            called = true;
            return Promise.resolve([hoverOf(["x"])]);
        };
        h.commands.execute("workbench.action.closeActiveEditor");
        expect(group().getActiveEditor()).toBeNull();

        await service().showHover();

        expect(called).toBe(false);
        expect(service().isOpen()).toBe(false);
    });

    it("каретка ушла из вьюпорта за время запроса — попап не открывается", async () => {
        group().hoverSource = () => Promise.resolve([hoverOf(["x"])]);
        const editor = group().getActiveEditor()!;
        // Якорь пропал (каретка вне видимой области) — тот же контракт, что у
        // suggest: getCaretAnchor() === null.
        editor.getCaretAnchor = () => null;

        await service().showHover();

        expect(service().isOpen()).toBe(false);
    });

    it("клик мимо попапа закрывает его (pointer-политика overlay-сессии)", async () => {
        group().hoverSource = () => Promise.resolve([hoverOf(["const answer: number"])]);
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
        group().hoverSource = () => Promise.resolve([hoverOf(["const answer: number"])]);
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        // Не прямой вызов onFocusChanged, а настоящий путь: фокус уходит в
        // дерево Explorer, WorkbenchContextKeys ловит смену и гасит попап.
        h.commands.execute("workbench.view.explorer");
        await flushMicrotasks();

        expect(service().isOpen()).toBe(false);
    });

    it("уход фокуса с редактора закрывает попап, возврат фокуса — нет", async () => {
        group().hoverSource = () => Promise.resolve([hoverOf(["x"])]);
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        // Фокус остался в редакторе (набор в самом редакторе) — попап живёт.
        service().onFocusChanged(true);
        expect(service().isOpen()).toBe(true);

        service().onFocusChanged(false);
        expect(service().isOpen()).toBe(false);
    });

    it("пустые блоки внутри одного hover'а не дают пустых строк в попапе", async () => {
        group().hoverSource = () =>
            Promise.resolve([hoverOf(["```ts\nconst a: number\n```", "```\n\n```", "документация"])]);

        await service().showHover();

        // Пустой после стрипа блок отброшен: между сигнатурой и доками ровно
        // одна пустая строка, а не две.
        expect(component().view.linesFor(60)).toEqual(["const a: number", "", "документация"]);
    });

    it("смена активного редактора закрывает попап и переносит подписки на новый", async () => {
        group().hoverSource = () => Promise.resolve([hoverOf(["x"])]);
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
        group().hoverSource = () => Promise.resolve([hoverOf(["x"])]);
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        // Правка в конце документа: каретка не двигается, но содержимое сменилось —
        // закрытие обязано прийти от подписки на контент, не на каретку.
        const editor = group().getActiveEditor()!;
        editor.applyExternalEdits([createTextEdit(createRange(1, 0, 1, 0), "// добавили\n")], "test");
        expect(service().isOpen()).toBe(false);
    });
});
