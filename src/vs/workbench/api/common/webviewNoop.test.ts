import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { makeStubRpc } from "./testStubRpc.ts";
import { Uri } from "./vscodeTypes.ts";
import { createWebviewNoopMembers } from "./webviewNoop.ts";

function makeMembers() {
    const stub = makeStubRpc();
    return { stub, members: createWebviewNoopMembers(stub.rpc) };
}

function outputLines(
    stub: ReturnType<typeof makeStubRpc>,
): { channel: string; label: string; level: string; value: string }[] {
    return stub.notifies
        .filter((n) => n.method === "output.append")
        .map((n) => n.params as { channel: string; label: string; level: string; value: string });
}

describe("webviewNoop — webview members of window as an honest no-op", () => {
    describe("createWebviewPanel", () => {
        it("returns an inert panel with a writable webview.html", () => {
            const { members } = makeMembers();

            const panel = members.createWebviewPanel("test.chat", "Chat", 1, {});
            // Extensions read html before the first write to tell whether they have rendered already.
            expect(panel.webview.html).toBe("");

            panel.webview.html = "<h1>chat</h1>";

            expect(panel.viewType).toBe("test.chat");
            expect(panel.title).toBe("Chat");
            expect(panel.webview.html).toBe("<h1>chat</h1>");
            expect(panel.webview.cspSource).not.toBe("");
        });

        it("there is no panel: visible/active are false, no column is taken, reveal does nothing", () => {
            const { members } = makeMembers();

            const panel = members.createWebviewPanel("test.chat", "Chat");

            expect(panel.visible).toBe(false);
            expect(panel.active).toBe(false);
            expect(panel.viewColumn).toBeUndefined();
            expect(panel.iconPath).toBeUndefined();
            expect(() => {
                panel.reveal(1, true);
            }).not.toThrow();
        });

        it("messages go nowhere and the view state change does not fire", async () => {
            const { members, stub } = makeMembers();
            const panel = members.createWebviewPanel("test.chat", "Chat");
            let stateChanges = 0;
            panel.onDidChangeViewState(() => {
                stateChanges++;
            });
            let received = 0;
            panel.webview.onDidReceiveMessage(() => {
                received++;
            });

            expect(await panel.webview.postMessage({ type: "ping" })).toBe(false);
            panel.dispose();

            expect(stateChanges).toBe(0);
            expect(received).toBe(0);
            // None of the panel operations sends anything to the host beyond the refusal line.
            expect(outputLines(stub)).toHaveLength(1);
        });

        it("asWebviewUri returns the same uri — there is nowhere to proxy resources", () => {
            const { members } = makeMembers();
            const panel = members.createWebviewPanel("test.chat", "Chat");
            const local = Uri.file("/proj/media/main.css") as unknown as vscode.Uri;

            expect(panel.webview.asWebviewUri(local)).toBe(local);
        });

        it("dispose fires onDidDispose exactly once", () => {
            const { members } = makeMembers();
            const panel = members.createWebviewPanel("test.chat", "Chat");
            let disposed = 0;
            panel.onDidDispose(() => {
                disposed++;
            });

            panel.dispose();
            panel.dispose();

            expect(disposed).toBe(1);
        });

        it("writes one line about the unsupported webview to Output", () => {
            const { members, stub } = makeMembers();

            members.createWebviewPanel("test.chat", "Chat");

            expect(outputLines(stub)).toEqual([
                {
                    channel: "extensions",
                    label: "Extensions",
                    level: "warn",
                    value: expect.stringContaining(
                        'webview is not supported in TUI: window.createWebviewPanel("test.chat")',
                    ) as unknown as string,
                },
            ]);
        });
    });

    describe("registerWebviewViewProvider", () => {
        it("returns an honest disposable and writes one line to Output", () => {
            const { members, stub } = makeMembers();

            const disposable = members.registerWebviewViewProvider("test.chatView", {
                resolveWebviewView: () => undefined,
            });
            expect(() => {
                disposable.dispose();
            }).not.toThrow();

            const lines = outputLines(stub);
            expect(lines).toHaveLength(1);
            expect(lines[0]?.value).toContain(
                'webview is not supported in TUI: window.registerWebviewViewProvider("test.chatView")',
            );
            expect(lines[0]?.level).toBe("warn");
        });
    });

    describe("registerWebviewPanelSerializer", () => {
        it("returns an honest disposable and writes one line to Output", () => {
            const { members, stub } = makeMembers();

            const disposable = members.registerWebviewPanelSerializer("test.chat", {
                deserializeWebviewPanel: () => Promise.resolve(),
            });
            expect(() => {
                disposable.dispose();
            }).not.toThrow();

            const lines = outputLines(stub);
            expect(lines).toHaveLength(1);
            expect(lines[0]?.value).toContain(
                'webview is not supported in TUI: window.registerWebviewPanelSerializer("test.chat")',
            );
            expect(lines[0]?.channel).toBe("extensions");
        });
    });

    describe("registerCustomEditorProvider", () => {
        it("returns an honest disposable and writes one line to Output", () => {
            const { members, stub } = makeMembers();

            const disposable = members.registerCustomEditorProvider(
                "java.formatterSettings",
                { resolveCustomTextEditor: () => Promise.resolve() },
                { webviewOptions: { retainContextWhenHidden: true } },
            );
            expect(() => {
                disposable.dispose();
            }).not.toThrow();

            const lines = outputLines(stub);
            expect(lines).toHaveLength(1);
            expect(lines[0]?.value).toContain(
                'webview is not supported in TUI: window.registerCustomEditorProvider("java.formatterSettings")',
            );
            expect(lines[0]?.channel).toBe("extensions");
        });
    });
});
