import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type {
    ICoreSignature,
    ICoreSignatureHelp,
    ISignatureHelpRequest,
} from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { CompletionServiceDIToken } from "../../suggest/browser/completionService.ts";

import { ParameterHintsComponentDIToken } from "./parameterHintsComponent.ts";
import { ParameterHintsServiceDIToken } from "./parameterHintsService.ts";

/** Даёт setTimeout(…, 0) авто-триггера отработать. */
function flushTimers(): Promise<void> {
    return new Promise((res) => setTimeout(res, 5));
}

const GREET: ICoreSignature = {
    label: "greet(name: string, age: number): void",
    parameters: [{ label: "name: string" }, { label: "age: number" }],
};
const GREET_SHORT: ICoreSignature = {
    label: "greet(name: string): void",
    parameters: [{ label: "name: string" }],
};
const GREET_EMPTY: ICoreSignature = { label: "greet(): void", parameters: [] };

function help(patch: Partial<ICoreSignatureHelp> = {}): ICoreSignatureHelp {
    return { signatures: [GREET], activeSignature: 0, activeParameter: 0, ...patch };
}

describe("ParameterHintsService — показ, авто-триггер и перегрузки", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-hints-",
            files: {
                "main.ts": "greet\nconst other = 1;\n",
                "other.ts": "export const other = 1;\n",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
        service().triggerDelayMs = 0; // детерминированный авто-триггер в тестах
        group().signatureHelpTriggerCharacters = ["(", ",", "<"];
        group().signatureHelpRetriggerCharacters = [")"];
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const group = () => h.container.get(EditorServiceDIToken);
    const service = () => h.container.get(ParameterHintsServiceDIToken);
    const component = () => h.container.get(ParameterHintsComponentDIToken);
    const lines = () => component().view.linesFor(60);

    it("команда показывает попап с меткой сигнатуры у каретки", async () => {
        group().signatureHelpSource = () => Promise.resolve(help());

        await service().trigger();

        expect(service().isOpen()).toBe(true);
        expect(lines()).toEqual(["greet(name: string, age: number): void"]);
        // Фокус остался в редакторе.
        expect(group().getActiveEditor()).not.toBeNull();
    });

    it("запрос несёт снапшот, позицию каретки и контекст ручного вызова", async () => {
        const seen: ISignatureHelpRequest[] = [];
        group().signatureHelpSource = (request) => {
            seen.push(request);
            return Promise.resolve(help());
        };
        group().getActiveEditor()?.goToPosition(1, 6);

        await service().trigger();

        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({
            line: 1,
            character: 6,
            triggerKind: SignatureHelpTriggerKind.Invoke,
            isRetrigger: false,
        });
        expect(seen[0].text).toContain("const other");
        // Пустых ключей в запросе нет вовсе: он уходит по RPC на каждое нажатие.
        expect(Object.keys(seen[0]).sort()).toEqual([
            "character",
            "isRetrigger",
            "languageId",
            "line",
            "text",
            "triggerKind",
            "uri",
        ]);
    });

    it("ручной вызов отменяет отложенный авто-запрос", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        group().signatureHelpSource = source;
        service().triggerDelayMs = 50;

        h.testApp.sendKey("End");
        h.testApp.sendKey("("); // запланировал авто-запрос
        await service().trigger(); // ручной вызов обгоняет его
        await flushTimers();
        await flushMicrotasks();

        // Отложенный запрос снят — иначе после ручного прилетел бы второй ответ.
        expect(source).toHaveBeenCalledTimes(1);
    });

    it("попап закрыли мимо сервиса (клик снаружи) — следующий запрос идёт без эха", async () => {
        const seen: ISignatureHelpRequest[] = [];
        group().signatureHelpSource = (request) => {
            seen.push(request);
            return Promise.resolve(help());
        };

        await service().trigger();
        // Overlay-сессия закрылась сама (pointerPolicy) — сервис об этом не знает
        // и держит прежний результат; запрос всё равно обязан быть «первым».
        component().close();
        await service().trigger();

        expect(seen[1].isRetrigger).toBe(false);
        expect(Object.keys(seen[1])).not.toContain("activeSignatureHelp");
    });

    it("набор триггер-символа сервера открывает подсказку сам", async () => {
        const seen: ISignatureHelpRequest[] = [];
        group().signatureHelpSource = (request) => {
            seen.push(request);
            return Promise.resolve(help());
        };

        h.testApp.sendKey("End");
        h.testApp.sendKey("(");
        await flushTimers();
        await flushMicrotasks();

        expect(service().isOpen()).toBe(true);
        expect(seen[0]).toMatchObject({
            triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
            triggerCharacter: "(",
            isRetrigger: false,
        });
    });

    it("символ не из списка сервера подсказку не открывает", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        group().signatureHelpSource = source;

        h.testApp.sendKey("End");
        h.testApp.sendKey("x");
        await flushTimers();
        await flushMicrotasks();

        expect(source).not.toHaveBeenCalled();
        expect(service().isOpen()).toBe(false);
    });

    it("пока попап открыт, правка перезапрашивает подсказку и двигает активный параметр", async () => {
        const seen: ISignatureHelpRequest[] = [];
        let activeParameter = 0;
        group().signatureHelpSource = (request) => {
            seen.push(request);
            return Promise.resolve(help({ activeParameter }));
        };

        h.testApp.sendKey("End");
        h.testApp.sendKey("(");
        await flushTimers();
        await flushMicrotasks();
        expect(component().view.linesFor(60)).toEqual([GREET.label]);

        // Запятая — тоже триггер-символ tsserver'а, но теперь это ретриггер.
        activeParameter = 1;
        h.testApp.sendKey(",");
        await flushTimers();
        await flushMicrotasks();

        expect(seen).toHaveLength(2);
        expect(seen[1]).toMatchObject({
            triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
            triggerCharacter: ",",
            isRetrigger: true,
        });
        // Эхо показанной подсказки — по нему сервер удерживает перегрузку.
        expect(seen[1].activeSignatureHelp).toEqual({ ...help(), activeSignature: 0 });
    });

    it("подсказка открывается и на строке, отличной от первой", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        group().signatureHelpSource = source;

        // Кэш каретки хранит НОМЕР строки: обнулись он на второй строке —
        // вставка перестала бы опознаваться как набор.
        group().getActiveEditor()?.goToPosition(1, 0);
        h.testApp.sendKey("End");
        h.testApp.sendKey("(");
        await flushTimers();
        await flushMicrotasks();

        expect(source).toHaveBeenCalledTimes(1);
        expect(service().isOpen()).toBe(true);
    });

    it("движение каретки при открытом попапе — ретриггер с ContentChange", async () => {
        const seen: ISignatureHelpRequest[] = [];
        group().signatureHelpSource = (request) => {
            seen.push(request);
            return Promise.resolve(help());
        };

        await service().trigger();
        h.testApp.sendKey("ArrowRight");
        await flushTimers();
        await flushMicrotasks();

        expect(seen).toHaveLength(2);
        expect(seen[1]).toMatchObject({
            triggerKind: SignatureHelpTriggerKind.ContentChange,
            isRetrigger: true,
        });
        expect(seen[1].triggerCharacter).toBeUndefined();
        expect(service().isOpen()).toBe(true);
    });

    it("закрывающая скобка гасит попап: сервер отвечает пустотой", async () => {
        const seen: ISignatureHelpRequest[] = [];
        let answer: ICoreSignatureHelp | null = help();
        group().signatureHelpSource = (request) => {
            seen.push(request);
            return Promise.resolve(answer);
        };

        await service().trigger();
        expect(service().isOpen()).toBe(true);

        answer = null;
        h.testApp.sendKey("End");
        h.testApp.sendKey(")");
        await flushTimers();
        await flushMicrotasks();

        expect(seen.at(-1)).toMatchObject({
            triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
            triggerCharacter: ")",
            isRetrigger: true,
        });
        expect(service().isOpen()).toBe(false);
    });

    it("ретриггер-символ при закрытом попапе ничего не запрашивает", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        group().signatureHelpSource = source;

        h.testApp.sendKey("End");
        h.testApp.sendKey(")");
        await flushTimers();
        await flushMicrotasks();

        expect(source).not.toHaveBeenCalled();
    });

    it("выделение вместо каретки закрывает попап", async () => {
        group().signatureHelpSource = () => Promise.resolve(help());

        // Выделение при закрытом попапе — просто ничего не делает.
        h.testApp.sendKey("Shift+ArrowRight");
        await flushTimers();
        expect(service().isOpen()).toBe(false);

        h.testApp.sendKey("ArrowLeft");
        await service().trigger();
        expect(service().isOpen()).toBe(true);

        h.testApp.sendKey("Shift+ArrowRight");
        await flushTimers();
        await flushMicrotasks();

        expect(service().isOpen()).toBe(false);
    });

    it("вставка блока текста — не набор: подсказку не открывает, открытую перезапрашивает", async () => {
        const seen: ISignatureHelpRequest[] = [];
        group().signatureHelpSource = (request) => {
            seen.push(request);
            return Promise.resolve(help());
        };

        // Вставка целого куска с триггер-символом внутри попап не открывает
        // (та же эвристика, что у автодополнения; в VS Code вставка тоже молчит).
        group().getActiveEditor()?.viewState.insertText("greet(");
        await flushTimers();
        await flushMicrotasks();
        expect(seen).toHaveLength(0);
        expect(service().isOpen()).toBe(false);

        // А при показанной подсказке вставка — обычная правка: перезапрос.
        await service().trigger();
        group().getActiveEditor()?.viewState.insertText("abc");
        await flushTimers();
        await flushMicrotasks();

        expect(seen).toHaveLength(2);
        expect(seen[1]).toMatchObject({ triggerKind: SignatureHelpTriggerKind.ContentChange, isRetrigger: true });
    });

    it("три перегрузки: next и prev ходят в разные стороны", async () => {
        group().signatureHelpSource = () =>
            Promise.resolve(help({ signatures: [GREET, GREET_SHORT, GREET_EMPTY] }));

        await service().trigger();
        expect(lines()[0]).toBe("1/3 greet(name: string, age: number): void");

        service().nextSignature();
        expect(lines()[0]).toBe("2/3 greet(name: string): void");

        service().previousSignature();
        expect(lines()[0]).toBe("1/3 greet(name: string, age: number): void");

        // Назад с первой — на последнюю, а не на вторую.
        service().previousSignature();
        expect(lines()[0]).toBe("3/3 greet(): void");
    });

    it("выбранную сервером перегрузку показываем сразу, выход за список сбрасываем", async () => {
        let activeSignature = 1;
        group().signatureHelpSource = () =>
            Promise.resolve(help({ signatures: [GREET, GREET_SHORT], activeSignature }));

        await service().trigger();
        expect(lines()[0]).toBe("2/2 greet(name: string): void");

        // Ровно длина списка — уже за границей.
        activeSignature = 2;
        service().close();
        await service().trigger();
        expect(lines()[0]).toBe("1/2 greet(name: string, age: number): void");
    });

    it("close() гасит содержимое попапа и отложенный запрос", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        group().signatureHelpSource = source;
        service().triggerDelayMs = 50;

        await service().trigger();
        expect(component().view.hint).not.toBeNull();

        h.testApp.sendKey("End");
        h.testApp.sendKey("("); // запланировал перезапрос
        service().close();
        await flushTimers();
        await flushMicrotasks();

        // Содержимое очищено (иначе оно мигнёт при следующем открытии), а
        // отложенный запрос снят.
        expect(component().view.hint).toBeNull();
        expect(source).toHaveBeenCalledTimes(1);
    });

    it("активного параметра нет (-1): подсветки и описания параметра тоже нет", async () => {
        group().signatureHelpSource = () =>
            Promise.resolve(
                help({
                    activeParameter: -1,
                    signatures: [
                        {
                            label: "greet(name: string): void",
                            documentation: "Здоровается.",
                            parameters: [{ label: "name: string", documentation: "кого" }],
                        },
                    ],
                }),
            );

        await service().trigger();

        expect(component().view.hint?.activeSpan).toEqual([0, 0]);
        // Описание параметра не подставляется наугад — только описание сигнатуры.
        expect(component().view.hint?.documentation).toEqual(["Здоровается."]);
    });

    it("сигнатура без описаний не даёт пустых блоков", async () => {
        group().signatureHelpSource = () => Promise.resolve(help({ signatures: [GREET_EMPTY] }));

        await service().trigger();

        expect(component().view.hint?.documentation).toEqual([]);
    });

    it("перегрузки листаются локально, без обращения к источнику", async () => {
        const source = vi.fn(() => Promise.resolve(help({ signatures: [GREET, GREET_SHORT] })));
        group().signatureHelpSource = source;

        await service().trigger();
        expect(service().hasMultipleSignatures()).toBe(true);
        expect(lines()[0]).toBe("1/2 greet(name: string, age: number): void");

        service().nextSignature();
        expect(lines()[0]).toBe("2/2 greet(name: string): void");
        // По кругу: со второй — снова на первую.
        service().nextSignature();
        expect(lines()[0]).toBe("1/2 greet(name: string, age: number): void");
        service().previousSignature();
        expect(lines()[0]).toBe("2/2 greet(name: string): void");

        expect(source).toHaveBeenCalledTimes(1);
    });

    it("листание без показанной подсказки — no-op", () => {
        // Команда стрелки живёт под `parameterHintsVisible`, но сервис обязан
        // пережить и прямой вызов (палитра, пользовательский кейбинд).
        expect(() => {
            service().nextSignature();
            service().previousSignature();
        }).not.toThrow();
        expect(service().hasMultipleSignatures()).toBe(false);
    });

    it("одна сигнатура: счётчика нет, попап даже не пересобирается", async () => {
        group().signatureHelpSource = () => Promise.resolve(help({ signatures: [GREET_SHORT] }));

        await service().trigger();
        const shown = component().view.hint;

        expect(service().hasMultipleSignatures()).toBe(false);
        service().nextSignature();
        service().previousSignature();

        // Тот же объект, а не равный: листать нечего — и перерисовывать нечего.
        expect(component().view.hint).toBe(shown);
        expect(lines()).toEqual(["greet(name: string): void"]);
    });

    it("выбранная стрелками перегрузка уезжает серверу в эхе следующего запроса", async () => {
        const seen: ISignatureHelpRequest[] = [];
        group().signatureHelpSource = (request) => {
            seen.push(request);
            return Promise.resolve(help({ signatures: [GREET, GREET_SHORT] }));
        };

        await service().trigger();
        service().nextSignature();
        await service().trigger();

        expect(seen[1].activeSignatureHelp?.activeSignature).toBe(1);
    });

    it("описания параметра и сигнатуры приезжают плоским текстом", async () => {
        group().signatureHelpSource = () =>
            Promise.resolve(
                help({
                    signatures: [
                        {
                            label: "greet(name: string): void",
                            documentation: "Здоровается **с человеком**.",
                            parameters: [{ label: "name: string", documentation: "`кого` приветствуем" }],
                        },
                    ],
                }),
            );

        await service().trigger();

        expect(lines()).toContain("кого приветствуем");
        expect(lines()).toContain("Здоровается с человеком.");
    });

    it("активный параметр самой сигнатуры важнее общего", async () => {
        group().signatureHelpSource = () =>
            Promise.resolve(
                help({
                    activeParameter: 0,
                    signatures: [{ ...GREET, activeParameter: 1 }],
                }),
            );

        await service().trigger();

        // Подсвечен второй параметр: диапазон считается от него.
        expect(component().view.linesFor(60)).toEqual([GREET.label]);
        const start = GREET.label.indexOf("age: number");
        expect(component().view.hint?.activeSpan).toEqual([start, start + "age: number".length]);
    });

    it("активная сигнатура вне диапазона списка не роняет попап", async () => {
        group().signatureHelpSource = () => Promise.resolve(help({ activeSignature: 7 }));

        await service().trigger();

        expect(service().isOpen()).toBe(true);
        expect(lines()).toEqual([GREET.label]);
    });

    it("нет источника — попап не открывается", async () => {
        await service().trigger();

        expect(service().isOpen()).toBe(false);
    });

    it("нет активного редактора — источник не вызывается", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        group().signatureHelpSource = source;
        h.commands.execute("workbench.action.closeActiveEditor");
        expect(group().getActiveEditor()).toBeNull();

        await service().trigger();

        expect(source).not.toHaveBeenCalled();
        expect(service().isOpen()).toBe(false);
    });

    it("каретка ушла из вьюпорта за время запроса — попап не открывается и закрывается", async () => {
        group().signatureHelpSource = () => Promise.resolve(help());
        const editor = group().getActiveEditor()!;

        // Показанный попап без якоря жить не может — уход каретки его гасит.
        await service().trigger();
        expect(service().isOpen()).toBe(true);
        editor.getCaretAnchor = () => null;
        await service().trigger();
        expect(service().isOpen()).toBe(false);

        // И повторно уже не открывается.
        await service().trigger();
        expect(service().isOpen()).toBe(false);
    });

    it("устаревший ответ не переоткрывает закрытый попап", async () => {
        let release: (value: ICoreSignatureHelp | null) => void = () => undefined;
        group().signatureHelpSource = () =>
            new Promise((resolve) => {
                release = resolve;
            });

        const pending = service().trigger();
        service().close();
        release(help());
        await pending;

        expect(service().isOpen()).toBe(false);
    });

    it("уход фокуса с редактора закрывает попап, возврат — нет", async () => {
        group().signatureHelpSource = () => Promise.resolve(help());
        await service().trigger();

        service().onFocusChanged(true);
        expect(service().isOpen()).toBe(true);

        service().onFocusChanged(false);
        expect(service().isOpen()).toBe(false);
    });

    it("смена активного редактора закрывает попап и переносит подписки", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        group().signatureHelpSource = source;
        const first = group().getActiveEditor()!;
        await service().trigger();
        expect(service().isOpen()).toBe(true);

        group().openFile(ws.path("other.ts"));
        expect(service().isOpen()).toBe(false);

        // Правка в ПРЕЖНЕМ редакторе больше не доходит до сервиса: подписки сняты.
        await service().trigger();
        const before = source.mock.calls.length;
        first.viewState.insertText("x");
        await flushTimers();
        await flushMicrotasks();
        expect(source).toHaveBeenCalledTimes(before);
        expect(service().isOpen()).toBe(true);
    });

    it("набор триггер-символа сразу после смены редактора открывает подсказку", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        group().signatureHelpSource = source;

        // Кэш каретки принадлежит прежнему редактору: без пересборки на привязке
        // первое же нажатие в новом файле не сойдётся по длине строки.
        group().openFile(ws.path("other.ts"));
        h.workbench.focusEditor();
        h.testApp.sendKey("(");
        await flushTimers();
        await flushMicrotasks();

        expect(source).toHaveBeenCalledTimes(1);
        expect(service().isOpen()).toBe(true);
    });

    it("Escape закрывает попап, стрелки листают перегрузки", async () => {
        group().signatureHelpSource = () => Promise.resolve(help({ signatures: [GREET, GREET_SHORT] }));

        await service().trigger();
        expect(service().isOpen()).toBe(true);

        h.testApp.sendKey("ArrowDown");
        expect(lines()[0]).toBe("2/2 greet(name: string): void");
        h.testApp.sendKey("ArrowUp");
        expect(lines()[0]).toBe("1/2 greet(name: string, age: number): void");

        h.testApp.sendKey("Escape");
        expect(service().isOpen()).toBe(false);
        // Escape не утёк в редактор: каретка на месте.
        expect(group().getActiveEditor()?.viewState.selections[0].active).toMatchObject({ line: 0, character: 0 });
    });

    it("при открытом попапе автодополнения Escape и стрелки принадлежат ему", async () => {
        group().signatureHelpSource = () => Promise.resolve(help({ signatures: [GREET, GREET_SHORT] }));
        group().completionSource = () =>
            Promise.resolve({ items: [{ label: "greet", insertText: "greet" }], isIncomplete: false });
        const completion = h.container.get(CompletionServiceDIToken);

        await service().trigger();
        await completion.trigger();
        expect(completion.isOpen()).toBe(true);
        expect(service().isOpen()).toBe(true);

        // Стрелка вниз ходит по списку пунктов, перегрузку не листает.
        h.testApp.sendKey("ArrowDown");
        expect(lines()[0]).toBe("1/2 greet(name: string, age: number): void");

        // Первый Escape гасит автодополнение, подсказка остаётся.
        h.testApp.sendKey("Escape");
        expect(completion.isOpen()).toBe(false);
        expect(service().isOpen()).toBe(true);

        // Второй — уже подсказку.
        h.testApp.sendKey("Escape");
        expect(service().isOpen()).toBe(false);
    });

    it("аккорд Ctrl+K Ctrl+P открывает подсказку", async () => {
        group().signatureHelpSource = () => Promise.resolve(help());

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Ctrl+P");
        await flushMicrotasks();

        expect(service().isOpen()).toBe(true);
    });
});
