import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { QuickInputComponent } from "../../browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputService } from "../../browser/parts/quickinput/quickInputService.ts";
import type { IWireQuickPickRequest } from "../common/wireTypes.ts";

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
            validates: false,
        });
        expect(component.view.title).toBe("Your name");
        expect(component.view.prompt).toBe("Как к вам обращаться");
        expect(component.view.placeholder).toBe("имя");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toBe("Ада");
    });

    it("Escape — undefined", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showInputBox({ handle: 1, validates: false });
        testApp.sendKey("Escape");
        await expect(pending).resolves.toBeUndefined();
    });

    it("валидация расширения показывается и блокирует Enter", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({
            handle: 1,
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
        const pending = adapter.showInputBox({ handle: 7, validates: false });
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
        const pending = adapter.showInputBox({ handle: 7, validates: false });
        adapter.cancel(8);
        expect(component.isOpen()).toBe(true);
        testApp.sendKey("Enter");
        await expect(pending).resolves.toBe("");
    });

    it("cancel по уже закрытому показу — no-op и чужую сессию не гасит", async () => {
        const { adapter, service, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({ handle: 7, validates: false });
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
        const first = adapter.showInputBox({ handle: 1, validates: false });
        const second = adapter.showQuickPick(pickRequest({ handle: 2 }));
        // Первый показ уже перехвачен вторым — его завершение слот НЕ трогает.
        await expect(first).resolves.toBeUndefined();

        adapter.cancel(2);
        expect(component.isOpen()).toBe(false);
        await expect(second).resolves.toBeUndefined();
    });

    it("перехват следующим показом расширения не оставляет прошлое обещание висеть", async () => {
        const { adapter, testApp } = createAdapter();
        const first = adapter.showInputBox({ handle: 1, validates: false });
        const second = adapter.showQuickPick(pickRequest({ handle: 2 }));
        await expect(first).resolves.toBeUndefined();
        testApp.sendKey("Enter");
        await expect(second).resolves.toEqual([0]);
    });
});
