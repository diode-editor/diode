import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createLanguageStatusItemFactory } from "./extHostLanguageStatus.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner } from "./vscodeHostContext.ts";
import { LanguageStatusSeverity } from "./vscodeTypes.ts";
import type { IWireLanguageStatusItem } from "./wireTypes.ts";

function makeFactory(): {
    stub: IStubRpc;
    create: (id: string, selector: vscode.DocumentSelector) => vscode.LanguageStatusItem;
    owner: ExtensionOwner;
    factory: (id: string, selector: vscode.DocumentSelector) => vscode.LanguageStatusItem;
} {
    const stub = makeStubRpc();
    const owner = new ExtensionOwner();
    const factory = createLanguageStatusItemFactory({ rpc: stub.rpc, owner });
    // As an extension's `activate` would call it: the overlay sets the owner for the duration of the call.
    const create = (id: string, selector: vscode.DocumentSelector) =>
        owner.runAs("acme.ruff", () => factory(id, selector));
    return { stub, create, owner, factory };
}

function traffic(stub: IStubRpc): { method: string; params: unknown }[] {
    return stub.notifies.filter((n) => n.method.startsWith("languages.statusItem."));
}

function lastUpdate(stub: IStubRpc): IWireLanguageStatusItem {
    const last = traffic(stub)
        .filter((n) => n.method === "languages.statusItem.update")
        .at(-1);
    if (last === undefined) throw new Error("no languages.statusItem.update at all");
    return last.params as IWireLanguageStatusItem;
}

describe("languages.createLanguageStatusItem: the producer of languages.statusItem.*", () => {
    it("creation sends the full default state at once, owned by the calling extension", () => {
        const { stub, create } = makeFactory();
        create("server", { language: "python", scheme: "file" });

        // Strict: an unset `name`/`detail` is left out, not sent as `undefined`.
        expect(traffic(stub)).toStrictEqual([
            {
                method: "languages.statusItem.update",
                params: {
                    handle: 0,
                    id: "acme.ruff/server",
                    source: "acme.ruff",
                    selector: [{ language: "python", scheme: "file" }],
                    text: "",
                    severity: 0,
                    busy: false,
                },
            },
        ]);
    });

    it("every field set resends the item; the getters read back what was set", () => {
        const { stub, create } = makeFactory();
        const item = create("server", "python");
        const sent = (): number => traffic(stub).length;

        item.text = "$(check) Ruff";
        expect(sent()).toBe(2);
        item.detail = "Native server";
        item.name = "Ruff";
        item.severity = LanguageStatusSeverity.Error as vscode.LanguageStatusSeverity;
        item.busy = true;
        item.command = { command: "ruff.restart", title: "Restart", arguments: [1, "a"] };
        item.selector = ["python", { language: "toml" }];
        expect(sent()).toBe(8);

        expect(lastUpdate(stub)).toEqual({
            handle: 0,
            id: "acme.ruff/server",
            source: "acme.ruff",
            selector: [{ language: "python" }, { language: "toml" }],
            name: "Ruff",
            text: "$(check) Ruff",
            detail: "Native server",
            severity: 2,
            busy: true,
            command: { command: "ruff.restart", title: "Restart", arguments: [1, "a"] },
        });
        expect(item).toMatchObject({ id: "server", text: "$(check) Ruff", detail: "Native server", busy: true });
        expect(item.severity).toBe(2);
        expect(item.command.command).toBe("ruff.restart");
        // Fields are own enumerable properties, as on upstream's object literal: spread and JSON see them.
        expect(Object.keys(item)).toEqual(expect.arrayContaining(["text", "detail", "severity", "busy", "command"]));
    });

    it("a command without arguments goes without the field; Warning is 1", () => {
        const { stub, create } = makeFactory();
        const item = create("server", "python");
        item.severity = LanguageStatusSeverity.Warning as vscode.LanguageStatusSeverity;
        item.command = { command: "ruff.show", title: "Show logs" };
        expect(lastUpdate(stub)).toMatchObject({ severity: 1, command: { command: "ruff.show", title: "Show logs" } });
        expect(lastUpdate(stub).command).not.toHaveProperty("arguments");
    });

    it("an unknown severity goes as Information", () => {
        const { stub, create } = makeFactory();
        const item = create("server", "python");
        item.severity = 7 as vscode.LanguageStatusSeverity;
        expect(lastUpdate(stub).severity).toBe(0);
    });

    it("dispose sends dispose once; later edits are not sent; the id can be taken again", () => {
        const { stub, create } = makeFactory();
        const item = create("server", "python");
        item.dispose();
        item.dispose();
        item.text = "late";
        expect(traffic(stub).map((n) => n.method)).toEqual([
            "languages.statusItem.update",
            "languages.statusItem.dispose",
        ]);
        expect(traffic(stub)[1]?.params).toEqual({ handle: 0 });

        create("server", "python");
        expect(lastUpdate(stub)).toMatchObject({ handle: 1, id: "acme.ruff/server" });
    });

    it("a second live item with the same id throws, as upstream; another extension may use it", () => {
        const { create, owner, stub, factory } = makeFactory();
        create("server", "python");
        expect(() => create("server", "python")).toThrow("LanguageStatusItem with id 'server' ALREADY exists");

        expect(() => owner.runAs("other.ext", () => factory("server", "python"))).not.toThrow();
        expect(() => factory("server", "python")).not.toThrow();
        expect(lastUpdate(stub)).toMatchObject({ id: "/server", source: "" });
    });
});
