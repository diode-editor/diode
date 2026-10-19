import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { QuickInputComponent } from "../../browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputService } from "../../browser/parts/quickinput/quickInputService.ts";
import type { IWireQuickPickEvent, IWireQuickPickRequest } from "../common/wireTypes.ts";

import { QuickInputExtensionAdapter } from "./quickInputExtensionAdapter.ts";

function createAdapter() {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { adapter: new QuickInputExtensionAdapter(service), service, component, testApp };
}

function pickRequest(overrides: Partial<IWireQuickPickRequest> = {}): IWireQuickPickRequest {
    return {
        handle: 1,
        canPickMany: false,
        items: [{ label: "alpha" }, { label: "beta" }, { label: "gamma" }],
        picked: [],
        ...overrides,
    };
}

describe("QuickInputExtensionAdapter.showInputBox", () => {
    it("поднимает оверлей с опциями расширения и отдаёт введённое", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({
            handle: 1,
            title: "Your name",
            prompt: "Как к вам обращаться",
            placeHolder: "имя",
            value: "Ада",
            password: false,
            validates: false,
        });
        expect(component.view.title).toBe("Your name");
        expect(component.view.prompt).toBe("Как к вам обращаться");
        expect(component.view.placeholder).toBe("имя");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toBe("Ада");
    });

    it("password из просьбы расширения включает маску, а отдаётся настоящий текст", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({ handle: 1, password: true, validates: false });
        testApp.sendKey("h");
        testApp.sendKey("i");

        expect(component.view.password).toBe(true);
        expect(component.view.inspectState().query).toBe("**");

        testApp.sendKey("Enter");
        await expect(pending).resolves.toBe("hi");
    });

    it("без password маски нет", () => {
        const { adapter, component } = createAdapter();
        void adapter.showInputBox({ handle: 1, password: false, validates: false });
        expect(component.view.password).toBe(false);
    });

    it("Escape — undefined", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showInputBox({ handle: 1, password: false, validates: false });
        testApp.sendKey("Escape");
        await expect(pending).resolves.toBeUndefined();
    });

    it("валидация расширения показывается и блокирует Enter", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({
            handle: 1,
            password: false,
            validates: true,
            validate: (value) =>
                Promise.resolve(value === "ab" ? { message: "Только цифры", severity: "error" as const } : null),
        });
        testApp.sendKey("a");
        testApp.sendKey("b");
        await Promise.resolve();
        await Promise.resolve();
        expect(component.view.validationMessage).toBe("Только цифры");
        expect(component.view.validationSeverity).toBe("error");
        testApp.sendKey("Enter");
        expect(component.isOpen()).toBe(true);

        testApp.sendKey("Backspace");
        await Promise.resolve();
        await Promise.resolve();
        testApp.sendKey("Enter");
        await expect(pending).resolves.toBe("a");
    });

    it("предупреждение расширения не блокирует Enter", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({
            handle: 1,
            password: false,
            validates: true,
            validate: () => Promise.resolve({ message: "Осторожно", severity: "warning" as const }),
        });
        testApp.sendKey("8");
        await Promise.resolve();
        await Promise.resolve();
        expect(component.view.validationSeverity).toBe("warning");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toBe("8");
    });
});

describe("QuickInputExtensionAdapter.showQuickPick", () => {
    it("одиночный выбор отвечает индексом выбранной строки", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest());
        testApp.sendKey("ArrowDown");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([1]);
    });

    it("без заголовка и плейсхолдера показ поднимается на дефолтах виджета", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest());
        expect(component.view.title).toBeUndefined();
        expect(component.view.placeholder).toBe("");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([0]);
    });

    it("заголовок и плейсхолдер списка доезжают до виджета", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ title: "Кто", placeHolder: "Выберите" }));
        expect(component.view.title).toBe("Кто");
        expect(component.view.placeholder).toBe("Выберите");
        testApp.sendKey("Escape");
        await pending;
    });

    it("множественный выбор без заголовка и плейсхолдера тоже поднимается", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ canPickMany: true }));
        expect(component.view.title).toBeUndefined();
        expect(component.view.placeholder).toBe("");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([]);
    });

    it("множественный выбор с заголовком и плейсхолдером доносит их до виджета", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showQuickPick(
            pickRequest({ canPickMany: true, title: "Что", placeHolder: "Отметьте" }),
        );
        expect(component.view.title).toBe("Что");
        expect(component.view.placeholder).toBe("Отметьте");
        testApp.sendKey("Escape");
        await pending;
    });

    it("описание пункта доезжает до виджета", () => {
        const { adapter, component } = createAdapter();
        void adapter.showQuickPick(pickRequest({ items: [{ label: "TypeScript", description: ".ts" }] }));
        expect(component.view.items[0]).toEqual({ label: "TypeScript", description: ".ts" });
    });

    it("Escape — undefined, а не пустой набор", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest());
        testApp.sendKey("Escape");
        await expect(pending).resolves.toBeUndefined();
    });

    it("множественный выбор отвечает индексами в порядке списка", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ canPickMany: true }));
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey(" ");
        testApp.sendKey("ArrowUp");
        testApp.sendKey("ArrowUp");
        testApp.sendKey(" ");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([0, 2]);
    });

    it("предотмеченные индексы открываются уже отмеченными", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ canPickMany: true, picked: [1] }));
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([1]);
    });

    it("множественный выбор без отметок — пустой массив индексов", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ canPickMany: true }));
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([]);
    });

    it("пустой список: Enter ничего не принимает, Escape отменяет", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ items: [] }));
        testApp.sendKey("Enter");
        expect(component.isOpen()).toBe(true);
        testApp.sendKey("Escape");
        await expect(pending).resolves.toBeUndefined();
    });
});

describe("QuickInputExtensionAdapter.cancel", () => {
    it("снимает свой живой показ и доводит обещание до undefined", async () => {
        const { adapter, component } = createAdapter();
        const pending = adapter.showInputBox({ handle: 7, password: false, validates: false });
        adapter.cancel(7);
        await expect(pending).resolves.toBeUndefined();
        expect(component.isOpen()).toBe(false);
    });

    it("снимает живой показ списка", async () => {
        const { adapter } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ handle: 9 }));
        adapter.cancel(9);
        await expect(pending).resolves.toBeUndefined();
    });

    it("чужой handle не трогает текущий показ", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({ handle: 7, password: false, validates: false });
        adapter.cancel(8);
        expect(component.isOpen()).toBe(true);
        testApp.sendKey("Enter");
        await expect(pending).resolves.toBe("");
    });

    it("cancel по уже закрытому показу — no-op и чужую сессию не гасит", async () => {
        const { adapter, service, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({ handle: 7, password: false, validates: false });
        testApp.sendKey("Escape");
        await pending;

        // Оверлей взял кто-то другой (наша собственная команда).
        const ours = service.input({ title: "Save As" });
        adapter.cancel(7);
        expect(component.isOpen()).toBe(true);
        testApp.sendKey("Enter");
        await expect(ours).resolves.toBe("");
    });

    it("cancel по закрытому СПИСКУ чужую сессию не гасит", async () => {
        const { adapter, service, component, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ handle: 5 }));
        testApp.sendKey("Escape");
        await pending;

        const ours = service.input({ title: "Save As" });
        adapter.cancel(5);
        expect(component.isOpen()).toBe(true);
        testApp.sendKey("Enter");
        await expect(ours).resolves.toBe("");
    });

    it("хвост перехваченного показа не сбрасывает слот перехватчика", async () => {
        const { adapter, component, testApp } = createAdapter();
        const first = adapter.showInputBox({ handle: 1, password: false, validates: false });
        const second = adapter.showQuickPick(pickRequest({ handle: 2 }));
        // Первый показ уже перехвачен вторым — его завершение слот НЕ трогает.
        await expect(first).resolves.toBeUndefined();

        adapter.cancel(2);
        expect(component.isOpen()).toBe(false);
        await expect(second).resolves.toBeUndefined();
    });

    it("перехват следующим показом расширения не оставляет прошлое обещание висеть", async () => {
        const { adapter, testApp } = createAdapter();
        const first = adapter.showInputBox({ handle: 1, password: false, validates: false });
        const second = adapter.showQuickPick(pickRequest({ handle: 2 }));
        await expect(first).resolves.toBeUndefined();
        testApp.sendKey("Enter");
        await expect(second).resolves.toEqual([0]);
    });
});

describe("QuickInputExtensionAdapter — объектный пикер", () => {
    function objectPick() {
        const env = createAdapter();
        const events: IWireQuickPickEvent[] = [];
        const emit = (event: IWireQuickPickEvent): void => {
            events.push(event);
        };
        return { ...env, events, emit };
    }

    it("первый апдейт заводит и показывает пикер; detail встаёт на место описания", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick(
            {
                handle: 5,
                visible: true,
                title: "Pick",
                items: [
                    { handle: 0, label: "Alpha", description: "first", detail: "ignored" },
                    { handle: 2, label: "Gamma", detail: "example.com/gamma" },
                ],
            },
            emit,
        );
        expect(component.isOpen()).toBe(true);
        expect(component.view.title).toBe("Pick");
        expect(component.view.items.map((item) => [item.label, item.description])).toEqual([
            ["Alpha", "first"],
            ["Gamma", "example.com/gamma"],
        ]);
    });

    it("действия человека уходят событиями с handle'ами пунктов расширения", () => {
        const { adapter, testApp, events, emit } = objectPick();
        adapter.updateQuickPick(
            {
                handle: 5,
                visible: true,
                items: [
                    { handle: 0, label: "Alpha" },
                    { handle: 2, label: "Gamma" },
                ],
            },
            emit,
        );
        events.length = 0;
        testApp.sendKey("ArrowDown");
        testApp.sendKey("Enter");
        testApp.sendKey("Escape");
        expect(events).toEqual([
            { handle: 5, kind: "changeActive", items: [2] },
            { handle: 5, kind: "changeSelection", items: [2] },
            { handle: 5, kind: "accept" },
            { handle: 5, kind: "hide" },
        ]);
    });

    it("набор — changeValue с текстом как есть", () => {
        const { adapter, testApp, events, emit } = objectPick();
        adapter.updateQuickPick({ handle: 5, visible: true }, emit);
        testApp.sendKey("$");
        expect(events).toContainEqual({ handle: 5, kind: "changeValue", value: "$" });
    });

    it("activeItems/selectedItems того же диффа разрешаются по НОВЫМ предметам", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick({ handle: 5, visible: true, items: [{ handle: 0, label: "old" }] }, emit);
        adapter.updateQuickPick(
            {
                handle: 5,
                canSelectMany: true,
                items: [
                    { handle: 0, label: "one" },
                    { handle: 1, label: "two" },
                ],
                activeItems: [1],
                selectedItems: [0, 9],
            },
            emit,
        );
        expect(component.view.inspectState()).toMatchObject({
            items: ["one", "two"],
            activeIndex: 1,
            checked: ["one"],
        });
    });

    it("null сбрасывает поле, visible:false прячет, следующий visible:true показывает снова", () => {
        const { adapter, component, events, emit } = objectPick();
        adapter.updateQuickPick({ handle: 5, visible: true, title: "T", step: 1, totalSteps: 2 }, emit);
        expect(component.view.title).toBe("T (1/2)");
        adapter.updateQuickPick({ handle: 5, title: null, step: null, totalSteps: null, placeholder: null }, emit);
        expect(component.view.title).toBeUndefined();

        adapter.updateQuickPick({ handle: 5, visible: false, prompt: "скрыто" }, emit);
        expect(component.isOpen()).toBe(false);
        expect(events.at(-1)).toEqual({ handle: 5, kind: "hide" });

        adapter.updateQuickPick({ handle: 5, visible: true }, emit);
        expect(component.isOpen()).toBe(true);
        expect(component.view.prompt).toBe("скрыто");
    });

    it("прочие флаги доезжают до сессии", () => {
        const { adapter, component, testApp, emit } = objectPick();
        adapter.updateQuickPick(
            {
                handle: 5,
                visible: true,
                matchOnDescription: true,
                matchOnDetail: true,
                keepScrollPosition: true,
                value: "sec",
                items: [
                    { handle: 0, label: "a", description: "first" },
                    { handle: 1, label: "b", detail: "second" },
                ],
            },
            emit,
        );
        expect(component.view.inspectState()).toMatchObject({ query: "sec", items: ["b"] });
        testApp.sendKey("Backspace");
        testApp.sendKey("Backspace");
        testApp.sendKey("Backspace");
        for (const ch of "fir") testApp.sendKey(ch);
        expect(component.view.inspectState()).toMatchObject({ items: ["a"] });
    });

    it("dispose прячет и забывает; повторный и чужой dispose молчат", () => {
        const { adapter, component, events, emit } = objectPick();
        adapter.updateQuickPick({ handle: 5, visible: true }, emit);
        adapter.disposeQuickPick(5);
        expect(component.isOpen()).toBe(false);
        expect(events.at(-1)).toEqual({ handle: 5, kind: "hide" });
        events.length = 0;
        adapter.disposeQuickPick(5);
        adapter.disposeQuickPick(6);
        expect(events).toEqual([]);

        // Тот же handle после снятия — новый пикер, а не воскрешённый старый.
        adapter.updateQuickPick({ handle: 5, visible: true }, emit);
        expect(component.view.title).toBeUndefined();
    });

    it("после dispose тот же handle заводит живой пикер заново", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick({ handle: 5, visible: true, title: "old" }, emit);
        adapter.disposeQuickPick(5);
        adapter.updateQuickPick({ handle: 5, visible: true }, emit);
        expect(component.isOpen()).toBe(true);
        expect(component.view.title).toBeUndefined();
    });

    it("незнакомый handle в activeItems выпадает, подсветка — по первому знакомому", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick(
            {
                handle: 5,
                visible: true,
                items: [
                    { handle: 0, label: "one" },
                    { handle: 1, label: "two" },
                ],
                activeItems: [9, 1],
            },
            emit,
        );
        expect(component.view.inspectState()).toMatchObject({ activeIndex: 1 });
    });

    it("дифф без поля его не трогает: ярлыки, шаги, флаги и запрос остаются", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick(
            {
                handle: 5,
                visible: true,
                title: "T",
                step: 1,
                totalSteps: 2,
                prompt: "p",
                placeholder: "ph",
                value: "o",
                canSelectMany: true,
                matchOnDescription: true,
                items: [{ handle: 0, label: "one", description: "x" }],
                selectedItems: [0],
            },
            emit,
        );
        adapter.updateQuickPick({ handle: 5, items: [{ handle: 0, label: "one", description: "x" }] }, emit);
        expect(component.view.inspectState()).toMatchObject({
            title: "T (1/2)",
            query: "o",
            items: ["one"],
            checked: [],
        });
        expect(component.view.prompt).toBe("p");
        expect(component.view.placeholder).toBe("ph");
    });

    it("keepScrollPosition из диффа держит подсветку на месте при новых предметах", () => {
        const { adapter, component, testApp, emit } = objectPick();
        const items = [
            { handle: 0, label: "one" },
            { handle: 1, label: "two" },
        ];
        adapter.updateQuickPick({ handle: 5, visible: true, keepScrollPosition: true, items }, emit);
        testApp.sendKey("ArrowDown");
        adapter.updateQuickPick({ handle: 5, items: [...items, { handle: 2, label: "three" }] }, emit);
        expect(component.view.inspectState()).toMatchObject({ activeIndex: 1 });
    });

    it("matchOnDetail из диффа ищет по detail, даже когда на экране его заслонило описание", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick(
            {
                handle: 5,
                visible: true,
                matchOnDetail: true,
                value: "hidden",
                items: [
                    { handle: 0, label: "a", description: "shown", detail: "hidden" },
                    { handle: 1, label: "b" },
                ],
            },
            emit,
        );
        expect(component.view.inspectState()).toMatchObject({ items: ["a"] });
    });

    it("пустое описание уступает место detail", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick(
            { handle: 5, visible: true, items: [{ handle: 0, label: "a", description: "", detail: "det" }] },
            emit,
        );
        expect(component.view.items[0]).toMatchObject({ description: "det" });
    });
});
