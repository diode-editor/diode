import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createApiCommands, type IApiCommandsDeps } from "./apiCommands.ts";
import { Uri } from "./vscodeTypes.ts";

function setup(): { open: (...args: unknown[]) => Promise<unknown>; deps: IApiCommandsDeps } {
    const deps: IApiCommandsDeps = {
        showTextDocument: vi.fn(() => Promise.resolve({})),
        openExternal: vi.fn(() => Promise.resolve(true)),
    };
    const handler = createApiCommands(deps).get("vscode.open");
    if (handler === undefined) throw new Error("vscode.open не зарегистрирована");
    return { open: async (...args) => handler(...args), deps };
}

describe("apiCommands — vscode.open", () => {
    it("Uri файла уходит в showTextDocument без опций и резолвится без значения", async () => {
        const { open, deps } = setup();
        const uri = Uri.file("/ws/greet_test.go");

        await expect(open(uri)).resolves.toBeUndefined();

        expect(deps.showTextDocument).toHaveBeenCalledWith(uri, undefined);
        expect(deps.openExternal).not.toHaveBeenCalled();
    });

    it("колонка числом становится опцией viewColumn, объект опций уходит как есть", async () => {
        const { open, deps } = setup();
        const uri = Uri.file("/ws/a.go");
        const options: vscode.TextDocumentShowOptions = { preserveFocus: true };

        await open(uri, 2);
        await open(uri, options, "label");

        expect(deps.showTextDocument).toHaveBeenNthCalledWith(1, uri, { viewColumn: 2 });
        expect(deps.showTextDocument).toHaveBeenNthCalledWith(2, uri, options);
    });

    it("null вместо колонки — как эталон, «без колонки»", async () => {
        const { open, deps } = setup();
        const uri = Uri.file("/ws/a.go");

        await open(uri, null);

        expect(deps.showTextDocument).toHaveBeenCalledWith(uri, undefined);
    });

    it("http(s) — строкой и Uri — уходит системному обработчику, не в редактор", async () => {
        const { open, deps } = setup();

        await open("https://github.com/golang/tools/releases");
        await open(Uri.parse("http://example.com/x"), 1);

        expect(deps.openExternal).toHaveBeenCalledTimes(2);
        expect(vi.mocked(deps.openExternal).mock.calls[0][0].toString(true)).toBe(
            "https://github.com/golang/tools/releases",
        );
        expect(vi.mocked(deps.openExternal).mock.calls[1][0].authority).toBe("example.com");
        expect(deps.showTextDocument).not.toHaveBeenCalled();
    });

    it("command: — молча ничего, команды отсюда не исполняются", async () => {
        const { open, deps } = setup();

        await expect(open(Uri.parse("command:workbench.action.quit"))).resolves.toBeUndefined();

        expect(deps.showTextDocument).not.toHaveBeenCalled();
        expect(deps.openExternal).not.toHaveBeenCalled();
    });

    it("невалидные аргументы — отказ с текстом эталона, ничего не открыто", async () => {
        const { open, deps } = setup();
        const uri = Uri.file("/ws/a.go");

        await expect(open("file:///ws/a.go")).rejects.toThrow(
            "Invalid argument 'uriOrString' when running 'vscode.open', received: file:///ws/a.go ",
        );
        await expect(open({ path: "/a" })).rejects.toThrow(
            `Invalid argument 'uriOrString' when running 'vscode.open', received: {\n\t"path": "/a"\n} `,
        );
        await expect(open(uri, "beside")).rejects.toThrow(
            "Invalid argument 'columnOrOptions' when running 'vscode.open', received: beside ",
        );
        await expect(open(uri, undefined, 7)).rejects.toThrow(
            "Invalid argument 'label' when running 'vscode.open', received: 7 ",
        );
        expect(deps.showTextDocument).not.toHaveBeenCalled();
    });

    it("строкой — только http(s) с начала: http:// принят, https: в середине и не-строка с http-toString — нет", async () => {
        const { open, deps } = setup();

        await open("http://example.com/x");
        await expect(open("file:///ws/https:x")).rejects.toThrow("Invalid argument 'uriOrString'");
        await expect(open({ toString: () => "https://example.com" })).rejects.toThrow("Invalid argument 'uriOrString'");

        expect(deps.openExternal).toHaveBeenCalledTimes(1);
        expect(vi.mocked(deps.openExternal).mock.calls[0][0].scheme).toBe("http");
    });
});
