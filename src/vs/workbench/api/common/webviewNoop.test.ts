import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { makeStubRpc } from "./testStubRpc.ts";
import { Uri } from "./vscodeTypes.ts";
import { createWebviewNoopMembers } from "./webviewNoop.ts";

// Инертная webview-поверхность: вызов не падает, панели нет, в Output —
// ровно одна внятная строка. Форма объекта повторяет upstream ровно настолько,
// насколько её трогает типовое расширение с чат-панелью (html сразу после
// создания, панель в context.subscriptions, сброс ссылки по onDidDispose).

function makeMembers() {
    const stub = makeStubRpc();
    return { stub, members: createWebviewNoopMembers(stub.rpc) };
}

/** Строки, ушедшие в панель Output (`output.append`). */
function outputLines(
    stub: ReturnType<typeof makeStubRpc>,
): { channel: string; label: string; level: string; value: string }[] {
    return stub.notifies
        .filter((n) => n.method === "output.append")
        .map((n) => n.params as { channel: string; label: string; level: string; value: string });
}

describe("webviewNoop — webview-члены window как честный no-op", () => {
    describe("createWebviewPanel", () => {
        it("возвращает инертную панель с записываемым webview.html", () => {
            const { members } = makeMembers();

            const panel = members.createWebviewPanel("test.chat", "Chat", 1, {});
            // Свежая панель — с пустым html, как в vscode: расширения читают его
            // до первой записи, чтобы понять, рисовали уже содержимое или нет.
            expect(panel.webview.html).toBe("");

            panel.webview.html = "<h1>chat</h1>";

            expect(panel.viewType).toBe("test.chat");
            expect(panel.title).toBe("Chat");
            expect(panel.webview.html).toBe("<h1>chat</h1>");
            expect(panel.webview.cspSource).not.toBe("");
        });

        it("панели нет: visible/active — false, колонка не занята, reveal ничего не делает", () => {
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

        it("сообщения никуда не уходят, а смена состояния не стреляет", async () => {
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

            // postMessage честно отвечает «не доставлено» — как скрытая панель в vscode.
            expect(await panel.webview.postMessage({ type: "ping" })).toBe(false);
            panel.dispose();

            expect(stateChanges).toBe(0);
            expect(received).toBe(0);
            // Ни одна из операций панели не шлёт хосту ничего сверх строки отказа.
            expect(outputLines(stub)).toHaveLength(1);
        });

        it("asWebviewUri отдаёт тот же uri — проксировать ресурсы некуда", () => {
            const { members } = makeMembers();
            const panel = members.createWebviewPanel("test.chat", "Chat");
            const local = Uri.file("/proj/media/main.css") as unknown as vscode.Uri;

            expect(panel.webview.asWebviewUri(local)).toBe(local);
        });

        it("dispose стреляет onDidDispose ровно один раз", () => {
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

        it("пишет в Output одну строку про неподдерживаемый webview", () => {
            const { members, stub } = makeMembers();

            members.createWebviewPanel("test.chat", "Chat");

            expect(outputLines(stub)).toEqual([
                {
                    channel: "extensions",
                    label: "Extensions",
                    level: "warn",
                    value: expect.stringContaining(
                        'webview в TUI не поддерживается: window.createWebviewPanel("test.chat")',
                    ) as unknown as string,
                },
            ]);
        });
    });

    describe("registerWebviewViewProvider", () => {
        it("возвращает честный disposable и пишет в Output одну строку", () => {
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
                'webview в TUI не поддерживается: window.registerWebviewViewProvider("test.chatView")',
            );
            expect(lines[0]?.level).toBe("warn");
        });
    });

    describe("registerWebviewPanelSerializer", () => {
        it("возвращает честный disposable и пишет в Output одну строку", () => {
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
                'webview в TUI не поддерживается: window.registerWebviewPanelSerializer("test.chat")',
            );
            expect(lines[0]?.channel).toBe("extensions");
        });
    });
});
