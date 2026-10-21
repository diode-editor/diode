import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { createWindowNamespace, slugifyChannelName } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

/** The runtime is ahead of the active part of vscode.d.ts. */
interface INaiveWindowSurface {
    showTextDocument(doc: unknown): Thenable<unknown>;
    tabGroups: {
        all: readonly unknown[];
        activeTabGroup: { tabs: readonly unknown[] };
        onDidChangeTabs(l: () => void): { dispose(): void };
        onDidChangeTabGroups(l: () => void): { dispose(): void };
    };
    onDidChangeVisibleTextEditors(l: () => void): { dispose(): void };
}

function makeWindow() {
    const stub = makeStubRpc();
    const owner = new ExtensionOwner();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner,
    };
    const window = createWindowNamespace(ctx);
    return { stub, window, owner, naive: window as unknown as INaiveWindowSurface };
}

describe("WindowNamespace — naive LSP surface", () => {
    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("createOutputChannel sends lines to the host (output.append) with level and label", () => {
        const { stub, window } = makeWindow();
        const channel = window.createOutputChannel("TS (Diode)") as unknown as {
            name: string;
            appendLine(v: string): void;
            logLevel: number;
            onDidChangeLogLevel: (l: () => void) => { dispose(): void };
            trace(v: unknown): void;
            debug(v: unknown): void;
            info(v: unknown): void;
            warn(v: unknown): void;
            error(v: unknown): void;
        };
        expect(channel.name).toBe("TS (Diode)");
        expect(channel.logLevel).toBe(3);
        expect(() => {
            channel.onDidChangeLogLevel(() => undefined).dispose();
        }).not.toThrow();

        channel.appendLine("language server started");
        channel.info("converted 3 diagnostics");
        channel.error({ message: "asDiagnostics failed" });
        channel.trace("t");
        channel.debug("d");
        channel.warn("w");

        const appends = stub.notifies.filter((n) => n.method === "output.append");
        expect(appends.map((n) => n.params)).toEqual([
            { channel: "extensions.ts-diode", label: "TS (Diode)", level: "info", value: "language server started" },
            { channel: "extensions.ts-diode", label: "TS (Diode)", level: "info", value: "converted 3 diagnostics" },
            {
                channel: "extensions.ts-diode",
                label: "TS (Diode)",
                level: "error",
                value: '{"message":"asDiagnostics failed"}',
            },
            { channel: "extensions.ts-diode", label: "TS (Diode)", level: "trace", value: "t" },
            { channel: "extensions.ts-diode", label: "TS (Diode)", level: "debug", value: "d" },
            { channel: "extensions.ts-diode", label: "TS (Diode)", level: "warn", value: "w" },
        ]);
    });

    it("append buffers until a newline; dispose flushes the rest; show sends output.show", () => {
        const { stub, window } = makeWindow();
        const channel = window.createOutputChannel("Buffered");

        channel.append("partial ");
        expect(stub.notifies.filter((n) => n.method === "output.append")).toHaveLength(0);

        channel.append("line\nnext ");
        let appends = stub.notifies.filter((n) => n.method === "output.append");
        expect(appends.map((n) => (n.params as { value: string }).value)).toEqual(["partial line"]);

        // appendLine flushes the buffered tail as a separate line before its own.
        channel.appendLine("tail");
        appends = stub.notifies.filter((n) => n.method === "output.append");
        expect(appends.map((n) => (n.params as { value: string }).value)).toEqual(["partial line", "next ", "tail"]);

        channel.append("rest");
        channel.dispose();
        appends = stub.notifies.filter((n) => n.method === "output.append");
        expect(appends.at(-1)?.params).toMatchObject({ value: "rest" });

        channel.show();
        expect(stub.notifies.filter((n) => n.method === "output.show").map((n) => n.params)).toEqual([
            { channel: "extensions.buffered", label: "Buffered" },
        ]);
        expect(() => {
            channel.clear();
        }).not.toThrow();
        expect(() => {
            channel.replace("x");
        }).not.toThrow();
        expect(() => {
            channel.hide();
        }).not.toThrow();
    });

    it("an extension channel is `extensions.<owner>.<slug>`; the owner is read at creation time", () => {
        const { stub, window, owner } = makeWindow();
        const channel = owner.runAs("diode.diode-lsp-typescript", () =>
            window.createOutputChannel("TypeScript (Diode)"),
        );
        // The line is written outside the creating call; the channel id does not change.
        channel.appendLine("started");
        channel.show();

        expect(stub.notifies.filter((n) => n.method.startsWith("output.")).map((n) => n.params)).toEqual([
            {
                channel: "extensions.diode.diode-lsp-typescript.typescript-diode",
                label: "TypeScript (Diode)",
                level: "info",
                value: "started",
            },
            { channel: "extensions.diode.diode-lsp-typescript.typescript-diode", label: "TypeScript (Diode)" },
        ]);
    });

    it("an extension channel named 'Host' does not collide with the host logger extensions.host", () => {
        const { stub, window, owner } = makeWindow();
        owner.runAs("pub.ext", () => window.createOutputChannel("Host")).show();

        const ids = stub.notifies
            .filter((n) => n.method === "output.show")
            .map((n) => (n.params as { channel: string }).channel);
        expect(ids).toEqual(["extensions.pub.ext.host"]);
        expect(ids).not.toContain("extensions.host");
    });

    it("slugifyChannelName: lower-case, non-alphanumerics to a hyphen, empty name — fallback", () => {
        expect(slugifyChannelName("TypeScript (Diode)")).toBe("typescript-diode");
        expect(slugifyChannelName("Git: log/\u0418\u0441\u0442\u043e\u0440\u0438\u044f")).toBe("git-log"); // "Istoriya": non-ASCII letters are dropped
        expect(slugifyChannelName("!!!")).toBe("channel");
    });

    it("showTextDocument sends editor.showTextDocument; without a host response — fallback to the active editor", async () => {
        const { stub, window, naive } = makeWindow();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/f.ts").toString() });

        // The stub RPC answers undefined; the real open location comes from the host
        // (see windowNamespace.showTextDocument.test.ts).
        await expect(naive.showTextDocument(Uri.file("/f.ts"))).resolves.toBe(window.activeTextEditor);
        const request = stub.requests.pop();
        expect(request?.method).toBe("editor.showTextDocument");
        expect(request?.params).toMatchObject({ uri: Uri.file("/f.ts").toString() });
    });

    it("tabGroups and onDidChangeVisibleTextEditors are valid naive objects", () => {
        const { naive } = makeWindow();
        expect(naive.tabGroups.all).toEqual([]);
        expect(naive.tabGroups.activeTabGroup.tabs).toEqual([]);
        expect(() => {
            naive.tabGroups.onDidChangeTabs(() => undefined).dispose();
        }).not.toThrow();
        expect(() => {
            naive.tabGroups.onDidChangeTabGroups(() => undefined).dispose();
        }).not.toThrow();
        expect(() => {
            naive.onDidChangeVisibleTextEditors(() => undefined).dispose();
        }).not.toThrow();
    });
});
