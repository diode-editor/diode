import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createMessageApi, parseMessageArgs, toWireMessageItem } from "./messageNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";

describe("parseMessageArgs — the four show*Message overloads", () => {
    it("no arguments after the text means no buttons", () => {
        expect(parseMessageArgs(undefined, [])).toEqual({ modal: false, items: [] });
    });

    it("strings after the text are buttons", () => {
        expect(parseMessageArgs("Activate", ["Free"])).toEqual({
            modal: false,
            items: ["Activate", "Free"],
        });
    });

    it("an object with `title` is a button, not options", () => {
        const item = { title: "Retry" };
        expect(parseMessageArgs(item, [])).toEqual({ modal: false, items: [item] });
    });

    it("an object without `title` is MessageOptions, buttons start at the third argument", () => {
        expect(parseMessageArgs({ modal: true, detail: "cannot be undone" }, ["Delete"])).toEqual({
            modal: true,
            detail: "cannot be undone",
            items: ["Delete"],
        });
    });

    it("an empty detail is the same as no detail", () => {
        expect(parseMessageArgs({ modal: true, detail: "" }, [])).toEqual({ modal: true, items: [] });
    });

    it("a non-string detail is dropped rather than passed as is", () => {
        expect(parseMessageArgs({ modal: true, detail: 7 }, [])).toEqual({ modal: true, items: [] });
    });

    it("garbage instead of options reads as 'no options' instead of breaking the show", () => {
        // A JS extension may pass anything; showing the message must not crash.
        expect(parseMessageArgs(null, ["One"])).toEqual({ modal: false, items: ["One"] });
        expect(parseMessageArgs(7, ["One"])).toEqual({ modal: false, items: ["One"] });
    });

    it("modal only on a strict true", () => {
        expect(parseMessageArgs({ modal: "yes" }, []).modal).toBe(false);
    });

    it("options without modal give a non-modal message", () => {
        expect(parseMessageArgs({ detail: "text" }, ["One"])).toEqual({
            modal: false,
            detail: "text",
            items: ["One"],
        });
    });
});

describe("toWireMessageItem", () => {
    it("a string button is its own title", () => {
        expect(toWireMessageItem("Activate")).toEqual({ title: "Activate", isCloseAffordance: false });
    });

    it("MessageItem carries isCloseAffordance", () => {
        expect(toWireMessageItem({ title: "Cancel", isCloseAffordance: true })).toEqual({
            title: "Cancel",
            isCloseAffordance: true,
        });
    });

    it("MessageItem without the flag is not a close affordance", () => {
        expect(toWireMessageItem({ title: "Retry" })).toEqual({ title: "Retry", isCloseAffordance: false });
    });
});

describe("createMessageApi", () => {
    it("sends a request with severity, text and buttons", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: null });
        const api = createMessageApi(stub.rpc);

        await api.showWarningMessage("careful", "Activate", "Free");

        expect(stub.requests).toEqual([
            {
                method: "window.showMessage",
                params: {
                    severity: "warn",
                    message: "careful",
                    modal: false,
                    items: [
                        { title: "Activate", isCloseAffordance: false },
                        { title: "Free", isCloseAffordance: false },
                    ],
                },
            },
        ]);
    });

    it("the three overloads have different severities", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: null });
        const api = createMessageApi(stub.rpc);

        await api.showInformationMessage("i");
        await api.showWarningMessage("w");
        await api.showErrorMessage("e");

        expect(stub.requests.map((r) => (r.params as { severity: string }).severity)).toEqual([
            "info",
            "warn",
            "error",
        ]);
    });

    it("modal and detail are taken from MessageOptions", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: null });
        const api = createMessageApi(stub.rpc);

        await api.showWarningMessage("Delete?", { modal: true, detail: "cannot be undone" }, "Delete");

        expect(stub.requests[0]?.params).toMatchObject({ modal: true, detail: "cannot be undone" });
    });

    it("returns the SAME button object the extension sent", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: 1 });
        const api = createMessageApi(stub.rpc);

        const retry: vscode.MessageItem = { title: "Retry" };
        const cancel: vscode.MessageItem = { title: "Cancel", isCloseAffordance: true };
        const answer = await api.showErrorMessage("failed", retry, cancel);

        expect(answer).toBe(cancel);
    });

    it("null in the response — closed without a choice", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: null });
        const api = createMessageApi(stub.rpc);

        await expect(api.showInformationMessage("hi", "One")).resolves.toBeUndefined();
    });

    it("an index outside the buttons — the response is not about this show, returns undefined", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: 7 });
        const api = createMessageApi(stub.rpc);

        await expect(api.showInformationMessage("hi", "One")).resolves.toBeUndefined();
    });

    it("a non-string text is shown as its string representation instead of breaking the show", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: null });
        const api = createMessageApi(stub.rpc);

        await api.showInformationMessage(7 as unknown as string);

        expect((stub.requests[0]?.params as { message: string }).message).toBe("7");
    });
});
