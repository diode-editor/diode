import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { typeText } from "../../../../../TestUtils/domQueries.ts";
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

/** Enter settles through a validation promise: give it a turn before asserting the box is still open. */
function settled(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("QuickInputService.input — validation message shape", () => {
    it("a bare string is an error: shown and blocks Enter", async () => {
        const { service, component, testApp } = createService();
        const result = service.input({ validateInput: (value) => (value === "bad" ? "Not allowed" : null) });
        testApp.sendKey("b");
        testApp.sendKey("a");
        testApp.sendKey("d");
        expect(component.view.validationMessage).toBe("Not allowed");
        expect(component.view.validationSeverity).toBe("error");

        testApp.sendKey("Enter");
        await settled();
        expect(component.isOpen()).toBe(true);

        testApp.sendKey("Backspace");
        expect(component.view.validationMessage).toBeNull();
        testApp.sendKey("Enter");
        await expect(result).resolves.toBe("ba");
    });

    it("a warning is shown but does not block Enter", async () => {
        const { service, component, testApp } = createService();
        const result = service.input({
            validateInput: () => ({ message: "Careful", severity: "warning" }),
        });
        testApp.sendKey("x");
        expect(component.view.validationMessage).toBe("Careful");
        expect(component.view.validationSeverity).toBe("warning");
        testApp.sendKey("Enter");
        await expect(result).resolves.toBe("x");
    });

    it("an info message does not block either", async () => {
        const { service, component, testApp } = createService();
        const result = service.input({ validateInput: () => ({ message: "For your information", severity: "info" }) });
        testApp.sendKey("y");
        expect(component.view.validationSeverity).toBe("info");
        testApp.sendKey("Enter");
        await expect(result).resolves.toBe("y");
    });

    it("the initial value is validated before the first keypress", () => {
        const { service, component } = createService();
        void service.input({ value: "bad", validateInput: (v) => (v === "bad" ? "Not allowed" : null) });
        expect(component.view.validationMessage).toBe("Not allowed");
    });

    it("showing without validation clears the message left from the previous one", async () => {
        const { service, component, testApp } = createService();
        const first = service.input({ validateInput: () => "Not allowed" });
        testApp.sendKey("a");
        expect(component.view.validationMessage).toBe("Not allowed");
        testApp.sendKey("Escape");
        await first;

        void service.input({ prompt: "clean show" });
        expect(component.view.validationMessage).toBeNull();
    });

    it("without validateInput there is no message and Enter goes through", async () => {
        const { service, component, testApp } = createService();
        const result = service.input({});
        testApp.sendKey("z");
        expect(component.view.validationMessage).toBeNull();
        testApp.sendKey("Enter");
        await expect(result).resolves.toBe("z");
    });

    it("after a warning, severity returns to error when the message clears", () => {
        const { service, component, testApp } = createService();
        void service.input({
            validateInput: (value) => (value === "w" ? { message: "Careful", severity: "warning" } : null),
        });
        testApp.sendKey("w");
        expect(component.view.validationSeverity).toBe("warning");
        testApp.sendKey("Backspace");
        expect(component.view.validationMessage).toBeNull();
        expect(component.view.validationSeverity).toBe("error");
    });
});

describe("QuickInputService.input — async validation", () => {
    it("the result applies when it arrives", async () => {
        const { service, component, testApp } = createService();
        const gate = deferred<InputValidation | null>();
        void service.input({ validateInput: () => gate.promise });
        testApp.sendKey("a");
        expect(component.view.validationMessage).toBeNull();

        gate.resolve("Bad");
        await gate.promise;
        expect(component.view.validationMessage).toBe("Bad");
    });

    it("a stale result is dropped: the screen shows the message for the current text", async () => {
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
        // Resolve in REVERSE order: "ab" first, then the stale "a".
        const forAb = gates.find((g) => g.value === "ab");
        const forA = gates.find((g) => g.value === "a");
        forAb?.gate.resolve("about ab");
        await forAb?.gate.promise;
        forA?.gate.resolve("about a");
        await forA?.gate.promise;

        expect(component.view.validationMessage).toBe("about ab");
    });

    it("a result for a closed show does not revive the message in the next one", async () => {
        const { service, component, testApp } = createService();
        const gate = deferred<InputValidation | null>();
        const first = service.input({ validateInput: () => gate.promise });
        testApp.sendKey("a");
        testApp.sendKey("Escape");
        await first;

        void service.input({ prompt: "second show" });
        gate.resolve("result from a past life");
        await gate.promise;
        expect(component.view.validationMessage).toBeNull();
    });

    it("an async error blocks Enter too", async () => {
        const { service, component, testApp } = createService();
        const gate = deferred<InputValidation | null>();
        void service.input({ validateInput: () => gate.promise });
        testApp.sendKey("a");
        gate.resolve("Bad");
        await gate.promise;

        testApp.sendKey("Enter");
        await settled();
        expect(component.isOpen()).toBe(true);
    });

    // The race behind the explorer-compact-segments e2e flake on windows: New File's `exists` check
    // was still running for the typed name while the screen kept the empty name's error.
    it("Enter during a pending check of the current text waits for it and accepts", async () => {
        const { service, component, testApp } = createService();
        const gate = deferred<InputValidation | null>();
        const result = service.input({
            validateInput: (value) => (value === "" ? "Please enter a name" : gate.promise),
        });
        typeText(testApp, "ok");
        expect(component.view.validationMessage).toBe("Please enter a name");

        testApp.sendKey("Enter");
        gate.resolve(null);

        await expect(result).resolves.toBe("ok");
    });

    it("Enter during a pending check that ends in an error keeps the box open with the message", async () => {
        const { service, component, testApp } = createService();
        const gate = deferred<InputValidation | null>();
        void service.input({ validateInput: (value) => (value === "" ? "Please enter a name" : gate.promise) });
        typeText(testApp, "taken");

        testApp.sendKey("Enter");
        gate.resolve("Already exists");
        await settled();

        expect(component.isOpen()).toBe(true);
        expect(component.view.validationMessage).toBe("Already exists");
    });

    it("Enter validates the text once: a check already running for it is reused", async () => {
        const { service, testApp } = createService();
        const checked: string[] = [];
        const result = service.input({
            validateInput: (value) => {
                checked.push(value);
                return Promise.resolve(null);
            },
        });
        testApp.sendKey("a");
        testApp.sendKey("Enter");

        await expect(result).resolves.toBe("a");
        expect(checked).toEqual(["", "a"]);
    });

    it("Enter after the box was taken over by another show does not resolve the old one", async () => {
        const { service, testApp } = createService();
        const gate = deferred<InputValidation | null>();
        const first = service.input({ validateInput: (value) => (value === "" ? null : gate.promise) });
        testApp.sendKey("a");
        testApp.sendKey("Enter");
        const second = service.input({ prompt: "second show" });
        gate.resolve(null);

        await expect(first).resolves.toBeUndefined();
        testApp.sendKey("b");
        testApp.sendKey("Enter");
        await expect(second).resolves.toBe("b");
    });
});
