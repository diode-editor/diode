import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";
import { Uri } from "./vscodeTypes.ts";

/**
 * Проводка API-команд в собранном `vscode`: `executeCommand("vscode.open")`
 * обязан дойти до тех же запросов хосту, что `window.showTextDocument` и
 * `env.openExternal`, и не уйти хосту как чужая команда.
 */
describe("vscode.commands — встроенная vscode.open", () => {
    it("Uri файла с колонкой — запрос editor.showTextDocument, а не commands.executeCommand", async () => {
        const stub = makeStubRpc();
        const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());

        await namespace.commands.executeCommand("vscode.open", Uri.file("/ws/greet_test.go"), 2);

        expect(stub.requests).toEqual([
            { method: "editor.showTextDocument", params: { uri: "file:///ws/greet_test.go", viewColumn: 2 } },
        ]);
    });

    it("https-ссылка — запрос env.openExternal", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ opened: true });
        const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());

        await namespace.commands.executeCommand("vscode.open", "https://github.com/golang/tools");

        expect(stub.requests).toEqual([
            { method: "env.openExternal", params: { uri: "https://github.com/golang/tools" } },
        ]);
    });
});
