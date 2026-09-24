import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { QuickInputComponent } from "./quickInputComponent.ts";
import type { InputValidation } from "./quickInputService.ts";
import { QuickInputService } from "./quickInputService.ts";

function createService(): { service: QuickInputService; component: QuickInputComponent; testApp: TestApp } {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { service, component, testApp };
}

/** Промис с ручным резолвом — им управляем гонкой ответов валидации. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

describe("QuickInputService.input — форма сообщения валидации", () => {
    it("голая строка — ошибка: показывается и блокирует Enter", async () => {
        const { service, component, testApp } = createService();
        const result = service.input({ validateInput: (value) => (value === "bad" ? "Так нельзя" : null) });
        testApp.sendKey("b");
        testApp.sendKey("a");
        testApp.sendKey("d");
        expect(component.view.validationMessage).toBe("Так нельзя");
        expect(component.view.validationSeverity).toBe("error");

        testApp.sendKey("Enter");
        // Enter съеден: показ на месте, промис не устаканился.
        expect(component.isOpen()).toBe(true);

        testApp.sendKey("Backspace");
        expect(component.view.validationMessage).toBeNull();
        testApp.sendKey("Enter");
        await expect(result).resolves.toBe("ba");
    });

    it("предупреждение показывается, но Enter не блокирует", async () => {
        const { service, component, testApp } = createService();
        const result = service.input({
            validateInput: () => ({ message: "Осторожно", severity: "warning" }),
        });
        testApp.sendKey("x");
        expect(component.view.validationMessage).toBe("Осторожно");
        expect(component.view.validationSeverity).toBe("warning");
        testApp.sendKey("Enter");
        await expect(result).resolves.toBe("x");
    });

    it("подсказка (info) тоже не блокирует", async () => {
        const { service, component, testApp } = createService();
        const result = service.input({ validateInput: () => ({ message: "К сведению", severity: "info" }) });
        testApp.sendKey("y");
        expect(component.view.validationSeverity).toBe("info");
        testApp.sendKey("Enter");
        await expect(result).resolves.toBe("y");
    });

    it("валидация начального значения сеется до первого нажатия", () => {
        const { service, component } = createService();
        void service.input({ value: "bad", validateInput: (v) => (v === "bad" ? "Так нельзя" : null) });
        expect(component.view.validationMessage).toBe("Так нельзя");
    });

    it("показ без валидации гасит сообщение, оставшееся от прошлого", async () => {
        const { service, component, testApp } = createService();
        const first = service.input({ validateInput: () => "Так нельзя" });
        testApp.sendKey("a");
        expect(component.view.validationMessage).toBe("Так нельзя");
        testApp.sendKey("Escape");
        await first;

        void service.input({ prompt: "чистый показ" });
        expect(component.view.validationMessage).toBeNull();
    });

    it("без validateInput сообщения нет и Enter проходит", async () => {
        const { service, component, testApp } = createService();
        const result = service.input({});
        testApp.sendKey("z");
        expect(component.view.validationMessage).toBeNull();
        testApp.sendKey("Enter");
        await expect(result).resolves.toBe("z");
    });

    it("после предупреждения строгость возвращается к error при очистке сообщения", () => {
        const { service, component, testApp } = createService();
        void service.input({
            validateInput: (value) => (value === "w" ? { message: "Осторожно", severity: "warning" } : null),
        });
        testApp.sendKey("w");
        expect(component.view.validationSeverity).toBe("warning");
        testApp.sendKey("Backspace");
        expect(component.view.validationMessage).toBeNull();
        expect(component.view.validationSeverity).toBe("error");
    });
});

describe("QuickInputService.input — асинхронная валидация", () => {
    it("ответ применяется, когда доедет", async () => {
        const { service, component, testApp } = createService();
        const gate = deferred<InputValidation | null>();
        void service.input({ validateInput: () => gate.promise });
        testApp.sendKey("a");
        expect(component.view.validationMessage).toBeNull();

        gate.resolve("Плохо");
        await gate.promise;
        expect(component.view.validationMessage).toBe("Плохо");
    });

    it("устаревший ответ отбрасывается: на экране сообщение о текущем тексте", async () => {
        const { service, component, testApp } = createService();
        const gates: { value: string; gate: ReturnType<typeof deferred<InputValidation | null>> }[] = [];
        void service.input({
            validateInput: (value) => {
                const gate = deferred<InputValidation | null>();
                gates.push({ value, gate });
                return gate.promise;
            },
        });
        testApp.sendKey("a");
        testApp.sendKey("b");
        // Отвечаем В ОБРАТНОМ порядке: сначала на «ab», потом на устаревшее «a».
        const forAb = gates.find((g) => g.value === "ab");
        const forA = gates.find((g) => g.value === "a");
        forAb?.gate.resolve("про ab");
        await forAb?.gate.promise;
        forA?.gate.resolve("про a");
        await forA?.gate.promise;

        expect(component.view.validationMessage).toBe("про ab");
    });

    it("ответ на закрытый показ не воскрешает сообщение в следующем", async () => {
        const { service, component, testApp } = createService();
        const gate = deferred<InputValidation | null>();
        const first = service.input({ validateInput: () => gate.promise });
        testApp.sendKey("a");
        testApp.sendKey("Escape");
        await first;

        void service.input({ prompt: "второй показ" });
        gate.resolve("ответ из прошлой жизни");
        await gate.promise;
        expect(component.view.validationMessage).toBeNull();
    });

    it("асинхронная ошибка так же блокирует Enter", async () => {
        const { service, component, testApp } = createService();
        const gate = deferred<InputValidation | null>();
        void service.input({ validateInput: () => gate.promise });
        testApp.sendKey("a");
        gate.resolve("Плохо");
        await gate.promise;

        testApp.sendKey("Enter");
        expect(component.isOpen()).toBe(true);
    });
});
