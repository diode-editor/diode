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
    if (handler === undefined) throw new Error("vscode.open is not registered");
    return { open: async (...args) => handler(...args), deps };
}

describe("apiCommands — vscode.open", () => {
    it("file Uri goes to showTextDocument without options and resolves with no value", async () => {
        const { open, deps } = setup();
        const uri = Uri.file("/ws/greet_test.go");

        await expect(open(uri)).resolves.toBeUndefined();

        expect(deps.showTextDocument).toHaveBeenCalledWith(uri, undefined);
        expect(deps.openExternal).not.toHaveBeenCalled();
    });

    it("a numeric column becomes the viewColumn option, an options object is passed as is", async () => {
        const { open, deps } = setup();
        const uri = Uri.file("/ws/a.go");
        const options: vscode.TextDocumentShowOptions = { preserveFocus: true };

        await open(uri, 2);
        await open(uri, options, "label");

        expect(deps.showTextDocument).toHaveBeenNthCalledWith(1, uri, { viewColumn: 2 });
        expect(deps.showTextDocument).toHaveBeenNthCalledWith(2, uri, options);
    });

    it("null instead of a column means 'no column', as upstream", async () => {
        const { open, deps } = setup();
        const uri = Uri.file("/ws/a.go");

        await open(uri, null);

        expect(deps.showTextDocument).toHaveBeenCalledWith(uri, undefined);
    });

    it("http(s), as a string and as a Uri, goes to the system handler, not the editor", async () => {
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

    it("command: silently does nothing, commands are not executed from here", async () => {
        const { open, deps } = setup();

        await expect(open(Uri.parse("command:workbench.action.quit"))).resolves.toBeUndefined();

        expect(deps.showTextDocument).not.toHaveBeenCalled();
        expect(deps.openExternal).not.toHaveBeenCalled();
    });

    it("invalid arguments reject with the upstream text, nothing is opened", async () => {
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

    it("as a string only a leading http(s): http:// is accepted, https: in the middle and a non-string with an http toString are not", async () => {
        const { open, deps } = setup();

        await open("http://example.com/x");
        await expect(open("file:///ws/https:x")).rejects.toThrow("Invalid argument 'uriOrString'");
        await expect(open({ toString: () => "https://example.com" })).rejects.toThrow("Invalid argument 'uriOrString'");

        expect(deps.openExternal).toHaveBeenCalledTimes(1);
        expect(vi.mocked(deps.openExternal).mock.calls[0][0].scheme).toBe("http");
    });
});
