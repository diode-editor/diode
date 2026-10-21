import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createQuickInputApi, toWireQuickPickItem, toWireValidation } from "./quickInputNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { CancellationTokenSource, InputBoxValidationSeverity, QuickPickItemKind } from "./vscodeTypes.ts";

function makeApi() {
    const stub = makeStubRpc();
    return { stub, api: createQuickInputApi(stub.rpc) };
}

/** The host reply is resolved by hand — it keeps the prompt open while validation requests run. */
function pendingAnswer(): { promise: Promise<unknown>; answer: (value: unknown) => void } {
    let answer!: (value: unknown) => void;
    const promise = new Promise<unknown>((resolve) => {
        answer = resolve;
    });
    return { promise, answer };
}

function lastRequest(stub: ReturnType<typeof makeStubRpc>, method: string): Record<string, unknown> {
    const found = [...stub.requests].reverse().find((r) => r.method === method);
    if (found === undefined) throw new Error(`no request "${method}"`);
    return found.params as Record<string, unknown>;
}

describe("toWireValidation", () => {
    it("a bare string is an error", () => {
        expect(toWireValidation("not allowed")).toEqual({ message: "not allowed", severity: "error" });
    });

    it("an empty string, null and undefined mean the value is fine", () => {
        expect(toWireValidation("")).toBeNull();
        expect(toWireValidation(null)).toBeNull();
        expect(toWireValidation(undefined)).toBeNull();
    });

    it("the object form carries its own severity", () => {
        expect(toWireValidation({ message: "oops", severity: InputBoxValidationSeverity.Warning } as never)).toEqual({
            message: "oops",
            severity: "warning",
        });
        expect(toWireValidation({ message: "for your information", severity: InputBoxValidationSeverity.Info } as never)).toEqual(
            { message: "for your information", severity: "info" },
        );
        expect(toWireValidation({ message: "trouble", severity: InputBoxValidationSeverity.Error } as never)).toEqual({
            message: "trouble",
            severity: "error",
        });
    });

    it("an object without a meaningful message means the value is fine", () => {
        expect(toWireValidation({ message: "", severity: InputBoxValidationSeverity.Error } as never)).toBeNull();
        expect(toWireValidation({ severity: InputBoxValidationSeverity.Error } as never)).toBeNull();
    });

    it("an unknown severity is treated as an error", () => {
        expect(toWireValidation({ message: "x", severity: 99 } as never)).toEqual({ message: "x", severity: "error" });
    });
});

describe("toWireQuickPickItem", () => {
    it("a string item is its own label", () => {
        expect(toWireQuickPickItem("apple")).toEqual({ label: "apple" });
    });

    it("the description is sent as is", () => {
        expect(toWireQuickPickItem({ label: "TS", description: ".ts" })).toEqual({ label: "TS", description: ".ts" });
    });

    it("detail is shown in place of the description when there is none", () => {
        expect(toWireQuickPickItem({ label: "TS", detail: "details" })).toEqual({
            label: "TS",
            description: "details",
        });
    });

    it("when both fields are set, the description wins", () => {
        expect(toWireQuickPickItem({ label: "TS", description: ".ts", detail: "details" })).toEqual({
            label: "TS",
            description: ".ts",
        });
    });

    it("an empty description gives way to detail", () => {
        expect(toWireQuickPickItem({ label: "TS", description: "", detail: "details" })).toEqual({
            label: "TS",
            description: "details",
        });
    });

    it("without both fields there is no description on the wire", () => {
        expect(toWireQuickPickItem({ label: "TS" })).toEqual({ label: "TS" });
    });
});

describe("window.showInputBox (shim)", () => {
    it("sends options to the host and resolves with the input", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "Ada" });
        const result = await api.showInputBox({
            title: "Your name",
            prompt: "What should we call you",
            placeHolder: "name",
            value: "seed",
        });
        expect(result).toBe("Ada");
        expect(lastRequest(stub, "window.showInputBox")).toMatchObject({
            title: "Your name",
            prompt: "What should we call you",
            placeHolder: "name",
            value: "seed",
            validates: false,
        });
    });

    it("host cancellation gives undefined", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: null });
        await expect(api.showInputBox({})).resolves.toBeUndefined();
    });

    it("an empty string is not a cancellation", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "" });
        await expect(api.showInputBox({})).resolves.toBe("");
    });

    it("password is sent to the host as a boolean, the host draws the mask", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "hunter2" });

        await api.showInputBox({ password: true });
        expect(lastRequest(stub, "window.showInputBox").password).toBe(true);

        await api.showInputBox({});
        expect(lastRequest(stub, "window.showInputBox").password).toBe(false);
    });

    it("the presence of validateInput is declared to the host as a flag", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "x" });
        await api.showInputBox({ validateInput: () => null });
        expect(lastRequest(stub, "window.showInputBox").validates).toBe(true);
    });

    it("the host asks for validation by handle and gets a parsed answer", async () => {
        const { stub, api } = makeApi();
        let handle = 0;
        stub.responder = (_method, params) => {
            handle = (params as { handle: number }).handle;
            return { value: "x" };
        };
        const pending = api.showInputBox({
            validateInput: (value) => (value === "bad" ? "Digits only" : null),
        });
        await pending;
        // The validator lives until the prompt closes: ask under the same handle.
        const { api: api2, stub: stub2 } = makeApi();
        let liveHandle = 0;
        const show = pendingAnswer();
        stub2.responder = (_m, params) => {
            liveHandle = (params as { handle: number }).handle;
            return show.promise;
        };
        const live = api2.showInputBox({ validateInput: (value) => (value === "bad" ? "Digits only" : null) });
        await Promise.resolve();
        await expect(
            stub2.callRequest("window.inputBox.validate", { handle: liveHandle, value: "bad" }),
        ).resolves.toEqual({ message: "Digits only", severity: "error" });
        await expect(
            stub2.callRequest("window.inputBox.validate", { handle: liveHandle, value: "8080" }),
        ).resolves.toBeNull();
        show.answer({ value: "8080" });
        await live;
        expect(handle).toBeGreaterThan(0);
    });

    it("validation with an async validator waits for its answer", async () => {
        const { stub, api } = makeApi();
        let liveHandle = 0;
        const show = pendingAnswer();
        stub.responder = (_m, params) => {
            liveHandle = (params as { handle: number }).handle;
            return show.promise;
        };
        const live = api.showInputBox({
            validateInput: async (value) => (value === "" ? null : `Checked: ${value}`),
        });
        await Promise.resolve();
        await expect(
            stub.callRequest("window.inputBox.validate", { handle: liveHandle, value: "ab" }),
        ).resolves.toEqual({ message: "Checked: ab", severity: "error" });
        show.answer({ value: "ab" });
        await live;
    });

    it("a validation request with a foreign or closed handle is fine", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "x" });
        await api.showInputBox({ validateInput: () => "not allowed" });
        await expect(stub.callRequest("window.inputBox.validate", { handle: 1, value: "y" })).resolves.toBeNull();
        await expect(stub.callRequest("window.inputBox.validate", { handle: 999, value: "y" })).resolves.toBeNull();
    });

    it("garbage validation params do not break the shim", async () => {
        const { stub } = makeApi();
        await expect(stub.callRequest("window.inputBox.validate", {})).resolves.toBeNull();
        await expect(stub.callRequest("window.inputBox.validate", { handle: 1 })).resolves.toBeNull();
    });

    it("the cancellation token sends the host a dismissal with its handle", async () => {
        const { stub, api } = makeApi();
        const show = pendingAnswer();
        let liveHandle = 0;
        stub.responder = (_m, params) => {
            liveHandle = (params as { handle: number }).handle;
            return show.promise;
        };
        const source = new CancellationTokenSource();
        const pending = api.showInputBox({}, source.token as unknown as vscode.CancellationToken);
        await Promise.resolve();
        source.cancel();
        expect(stub.notifies).toContainEqual({
            method: "window.quickInput.cancel",
            params: { handle: liveHandle },
        });
        show.answer({ value: null });
        await expect(pending).resolves.toBeUndefined();
    });

    it("with no options at all the input box opens with defaults", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "x" });
        await expect(api.showInputBox()).resolves.toBe("x");
        expect(lastRequest(stub, "window.showInputBox")).toMatchObject({ validates: false });
    });

    it("the input box handle grows monotonically, two boxes are not confused", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "x" });
        await api.showInputBox({});
        const first = lastRequest(stub, "window.showInputBox").handle as number;
        await api.showInputBox({});
        const second = lastRequest(stub, "window.showInputBox").handle as number;
        expect(second).toBeGreaterThan(first);
    });

    it("a non-string value in a validation request does not reach the validator", async () => {
        const { stub, api } = makeApi();
        const show = pendingAnswer();
        let liveHandle = 0;
        let asked = 0;
        stub.responder = (_m, params) => {
            liveHandle = (params as { handle: number }).handle;
            return show.promise;
        };
        const live = api.showInputBox({
            validateInput: () => {
                asked++;
                return "not allowed";
            },
        });
        await Promise.resolve();
        await expect(
            stub.callRequest("window.inputBox.validate", { handle: liveHandle, value: 7 }),
        ).resolves.toBeNull();
        expect(asked).toBe(0);
        show.answer({ value: "x" });
        await live;
    });

    it("a token cancelled AFTER the input box closes no longer writes to the host", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "x" });
        const source = new CancellationTokenSource();
        await api.showInputBox({}, source.token as unknown as vscode.CancellationToken);
        source.cancel();
        expect(stub.notifies.filter((n) => n.method === "window.quickInput.cancel")).toHaveLength(0);
    });

    it("an already cancelled token does not open the input box at all", async () => {
        const { stub, api } = makeApi();
        const source = new CancellationTokenSource();
        source.cancel();
        await expect(
            api.showInputBox({}, source.token as unknown as vscode.CancellationToken),
        ).resolves.toBeUndefined();
        expect(stub.requests).toHaveLength(0);
    });
});

describe("window.showQuickPick (shim)", () => {
    it("strings: resolves with the picked string", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [1] });
        await expect(api.showQuickPick(["apple", "banana", "cherry"])).resolves.toBe("banana");
    });

    it("items: returns THE SAME object the extension sent", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [2] });
        const items = [{ label: "a" }, { label: "b" }, { label: "c" }];
        await expect(api.showQuickPick(items)).resolves.toBe(items[2]);
    });

    it("separators are neither shown nor picked; answer indices refer to the remaining items", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [1] });
        // Shape of `Go: Choose Go Environment`: group headers between the options.
        const items: vscode.QuickPickItem[] = [
            { label: "Locally discovered", kind: QuickPickItemKind.Separator },
            { label: "go1.27.2" },
            { label: "Downloadable", kind: QuickPickItemKind.Separator },
            { label: "go1.26.0", kind: QuickPickItemKind.Default },
        ];
        await expect(api.showQuickPick(items)).resolves.toBe(items[3]);
        expect((lastRequest(stub, "window.showQuickPick").items as { label: string }[]).map((i) => i.label)).toEqual([
            "go1.27.2",
            "go1.26.0",
        ]);
    });

    it("cancellation gives undefined", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: null });
        await expect(api.showQuickPick(["a"])).resolves.toBeUndefined();
    });

    it("canPickMany resolves with an array, an empty selection with an empty array", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [0, 2] });
        await expect(api.showQuickPick(["a", "b", "c"], { canPickMany: true })).resolves.toEqual(["a", "c"]);
        stub.responder = () => ({ indices: [] });
        await expect(api.showQuickPick(["a", "b", "c"], { canPickMany: true })).resolves.toEqual([]);
    });

    it("a cancelled canPickMany gives undefined, not an empty array", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: null });
        await expect(api.showQuickPick(["a"], { canPickMany: true })).resolves.toBeUndefined();
    });

    it("a promised list is awaited and sent to the host already filled", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [0] });
        const items = Promise.resolve(["ready-1", "ready-2"]);
        await expect(api.showQuickPick(items)).resolves.toBe("ready-1");
        expect(lastRequest(stub, "window.showQuickPick").items).toEqual([{ label: "ready-1" }, { label: "ready-2" }]);
    });

    it("pre-picked items are sent as indices, and only with canPickMany", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [] });
        const items = [{ label: "a" }, { label: "b", picked: true }, { label: "c", picked: true }];
        await api.showQuickPick(items, { canPickMany: true });
        expect(lastRequest(stub, "window.showQuickPick").picked).toEqual([1, 2]);

        await api.showQuickPick(items);
        expect(lastRequest(stub, "window.showQuickPick").picked).toEqual([]);
    });

    it("an out-of-range index is dropped, not turned into undefined", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [0, 99] });
        await expect(api.showQuickPick(["a", "b"], { canPickMany: true })).resolves.toEqual(["a"]);
    });

    it("an index equal to the list length is out of range too", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [2] });
        await expect(api.showQuickPick(["a", "b"], { canPickMany: true })).resolves.toEqual([]);
    });

    it("a string list has no pre-picked items", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [] });
        await api.showQuickPick(["a", "b"], { canPickMany: true });
        expect(lastRequest(stub, "window.showQuickPick").picked).toEqual([]);
    });

    it("with no options at all the list opens with defaults", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [0] });
        await expect(api.showQuickPick(["a"])).resolves.toBe("a");
        expect(lastRequest(stub, "window.showQuickPick")).toMatchObject({ canPickMany: false, picked: [] });
    });

    it("the list handle grows monotonically", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: null });
        await api.showQuickPick(["a"]);
        const first = lastRequest(stub, "window.showQuickPick").handle as number;
        await api.showQuickPick(["a"]);
        const second = lastRequest(stub, "window.showQuickPick").handle as number;
        expect(second).toBeGreaterThan(first);
    });

    it("a token cancelled AFTER the list closes no longer writes to the host", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: null });
        const source = new CancellationTokenSource();
        await api.showQuickPick(["a"], {}, source.token as unknown as vscode.CancellationToken);
        source.cancel();
        expect(stub.notifies.filter((n) => n.method === "window.quickInput.cancel")).toHaveLength(0);
    });

    it("title and placeholder are sent to the host", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: null });
        await api.showQuickPick(["a"], { title: "Who", placeHolder: "Pick one" });
        expect(lastRequest(stub, "window.showQuickPick")).toMatchObject({
            title: "Who",
            placeHolder: "Pick one",
            canPickMany: false,
        });
    });

    it("a token cancelled while the list was being computed does not open the picker", async () => {
        const { stub, api } = makeApi();
        const source = new CancellationTokenSource();
        const items = Promise.resolve(["a"]).then((value) => {
            source.cancel();
            return value;
        });
        await expect(
            api.showQuickPick(items, {}, source.token as unknown as vscode.CancellationToken),
        ).resolves.toBeUndefined();
        expect(stub.requests).toHaveLength(0);
    });

    it("the cancellation token sends the host a dismissal", async () => {
        const { stub, api } = makeApi();
        const show = pendingAnswer();
        stub.responder = () => show.promise;
        const source = new CancellationTokenSource();
        const pending = api.showQuickPick(["a"], {}, source.token as unknown as vscode.CancellationToken);
        await Promise.resolve();
        source.cancel();
        expect(stub.notifies.filter((n) => n.method === "window.quickInput.cancel")).toHaveLength(1);
        show.answer({ indices: null });
        await expect(pending).resolves.toBeUndefined();
    });
});
