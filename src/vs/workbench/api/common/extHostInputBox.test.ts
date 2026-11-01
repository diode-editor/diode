import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { QuickInputButtons } from "./quickInputButtons.ts";
import { createQuickInputApi } from "./quickInputNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { InputBoxValidationSeverity, ThemeIcon } from "./vscodeTypes.ts";

function setup() {
    const stub = makeStubRpc();
    const api = createQuickInputApi(stub.rpc);
    const box = api.createInputBox();
    const updates = (): Record<string, unknown>[] =>
        stub.notifies
            .filter((n) => n.method === "window.quickPick.update")
            .map((n) => n.params as Record<string, unknown>);
    const hostEvent = (event: Record<string, unknown>): void => {
        stub.fire("window.quickPick.event", { handle: updates()[0]?.handle ?? 1, ...event });
    };
    return { stub, api, box, updates, hostEvent };
}

describe("window.createInputBox: state and wire", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("[api:window.createInputBox] [api:InputBox.value] [api:InputBox.prompt] [api:InputBox.placeholder] show() sends the state; the first update marks the input box flavor", () => {
        const { box, updates } = setup();
        box.title = "Group";
        box.step = 2;
        box.totalSteps = 3;
        box.value = "com.example";
        box.placeholder = "e.g. com.example";
        box.prompt = "Input group Id";
        vi.runAllTimers();
        expect(updates()).toEqual([]);

        box.show();

        expect(updates()).toEqual([
            {
                handle: expect.any(Number) as number,
                inputBox: true,
                title: "Group",
                step: 2,
                totalSteps: 3,
                value: "com.example",
                placeholder: "e.g. com.example",
                prompt: "Input group Id",
                visible: true,
            },
        ]);
    });

    it("[api:InputBox.password] [api:InputBox.valueSelection] later changes are a diff without the flavor mark; unset selection is null", () => {
        const { box, updates } = setup();
        expect(box.password).toBe(false);
        expect(box.valueSelection).toBeUndefined();
        expect(box.validationMessage).toBeUndefined();
        box.show();
        box.password = true;
        box.valueSelection = [1, 2];
        vi.runAllTimers();
        expect(updates()[1]).toEqual({ handle: box_handle(updates), password: true, valueSelection: [1, 2] });
        expect(box.password).toBe(true);
        expect(box.valueSelection).toEqual([1, 2]);

        box.valueSelection = undefined;
        vi.runAllTimers();
        expect(updates()[2]).toEqual({ handle: box_handle(updates), valueSelection: null });
    });

    it("[api:InputBox.validationMessage] a string is an error, a message keeps its severity, undefined clears", () => {
        const { box, updates } = setup();
        box.show();
        box.validationMessage = "Invalid Group Id";
        vi.runAllTimers();
        expect(updates().at(-1)?.validationMessage).toEqual({ message: "Invalid Group Id", severity: "error" });
        expect(box.validationMessage).toBe("Invalid Group Id");

        box.validationMessage = {
            message: "Careful",
            severity: InputBoxValidationSeverity.Warning as unknown as vscode.InputBoxValidationSeverity,
        };
        vi.runAllTimers();
        expect(updates().at(-1)?.validationMessage).toEqual({ message: "Careful", severity: "warning" });

        box.validationMessage = undefined;
        vi.runAllTimers();
        expect(updates().at(-1)?.validationMessage).toBeNull();
    });

    it("[api:InputBox.onDidChangeValue] [api:InputBox.onDidAccept] [api:QuickInput.onDidHide] host events reach the extension", () => {
        const { box, hostEvent } = setup();
        const log: string[] = [];
        box.onDidChangeValue((value) => log.push(`value ${value}`));
        box.onDidAccept(() => log.push("accept"));
        box.onDidHide(() => log.push("hide"));
        box.show();

        hostEvent({ kind: "changeValue", value: "demo" });
        hostEvent({ kind: "accept" });
        hostEvent({ kind: "hide" });

        expect(log).toEqual(["value demo", "accept", "hide"]);
        expect(box.value).toBe("demo");
    });

    it("dispose tells the host, and later events and setters go nowhere", () => {
        const { stub, box, updates, hostEvent } = setup();
        const log: string[] = [];
        box.onDidAccept(() => log.push("accept"));
        box.show();
        const sent = updates().length;

        box.dispose();
        box.dispose();
        hostEvent({ kind: "accept" });
        box.value = "late";
        vi.runAllTimers();

        expect(log).toEqual([]);
        expect(updates()).toHaveLength(sent);
        expect(stub.notifies.filter((n) => n.method === "window.quickPick.dispose")).toHaveLength(1);
    });
});

describe("QuickInput buttons", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("[api:QuickInputButtons.Back] [api:InputBox.buttons] [api:InputBox.onDidTriggerButton] Back reaches the host as a flag and returns as the same object", () => {
        const { box, updates, hostEvent } = setup();
        const pressed: vscode.QuickInputButton[] = [];
        box.onDidTriggerButton((button) => pressed.push(button));
        box.buttons = [QuickInputButtons.Back];
        box.show();

        expect(updates()[0]?.back).toBe(true);
        hostEvent({ kind: "back" });

        expect(pressed).toEqual([QuickInputButtons.Back]);
        expect(pressed[0]).toBe(QuickInputButtons.Back);
        expect(box.buttons).toEqual([QuickInputButtons.Back]);

        box.buttons = [];
        vi.runAllTimers();
        expect(updates().at(-1)?.back).toBe(false);
    });

    it("buttons start empty and are a copy: editing your own array changes nothing", () => {
        const { box } = setup();
        expect(box.buttons).toEqual([]);
        const own = [QuickInputButtons.Back];
        box.buttons = own;
        own.pop();
        expect(box.buttons).toEqual([QuickInputButtons.Back]);
    });

    it("an event of another flavor is not taken for the Back button", () => {
        const { box, hostEvent } = setup();
        const pressed: vscode.QuickInputButton[] = [];
        box.onDidTriggerButton((button) => pressed.push(button));
        box.show();
        hostEvent({ kind: "changeActive", items: [0] });
        hostEvent({ kind: "changeSelection", items: [0] });
        expect(pressed).toEqual([]);
    });

    it("dispose unsubscribes every listener", () => {
        const { box } = setup();
        const log: string[] = [];
        box.onDidChangeValue(() => log.push("value"));
        box.onDidAccept(() => log.push("accept"));
        box.onDidHide(() => log.push("hide"));
        box.onDidTriggerButton(() => log.push("button"));
        box.dispose();

        const direct = box as unknown as { acceptEvent(event: Record<string, unknown>): void };
        for (const kind of ["accept", "hide", "back"]) direct.acceptEvent({ handle: 1, kind });
        direct.acceptEvent({ handle: 1, kind: "changeValue", value: "x" });

        expect(log).toEqual([]);
    });

    it("[api:QuickPick.buttons] [api:QuickPick.onDidTriggerButton] the picker has the same Back; a custom button stays with the extension", () => {
        const stub = makeStubRpc();
        const pick = createQuickInputApi(stub.rpc).createQuickPick();
        const pressed: vscode.QuickInputButton[] = [];
        pick.onDidTriggerButton((button) => pressed.push(button));
        const custom: vscode.QuickInputButton = { iconPath: new ThemeIcon("gear") };
        pick.buttons = [custom];
        pick.show();
        const first = stub.notifies.find((n) => n.method === "window.quickPick.update")?.params as {
            back?: boolean;
            inputBox?: boolean;
            handle: number;
        };
        expect(first.back).toBe(false);
        expect(first.inputBox).toBeUndefined();
        expect(pick.buttons).toEqual([custom]);

        stub.fire("window.quickPick.event", { handle: first.handle, kind: "back" });
        expect(pressed).toEqual([QuickInputButtons.Back]);
    });

    it("[api:QuickPick.onDidTriggerItemButton] an extension can subscribe: item buttons are not drawn, so it stays silent", () => {
        const stub = makeStubRpc();
        const pick = createQuickInputApi(stub.rpc).createQuickPick();
        const pressed: unknown[] = [];
        const subscription = pick.onDidTriggerItemButton((event) => pressed.push(event));
        pick.show();
        subscription.dispose();
        pick.dispose();
        expect(pressed).toEqual([]);
    });
});

function box_handle(updates: () => Record<string, unknown>[]): number {
    return updates()[0]?.handle as number;
}
