import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";
import { CodeLens, Position, Range } from "./vscodeTypes.ts";

const URI = "file:///proj/main.ts";

/** One lens with the command `id`, through the real `commands` namespace; the host knows only `host.known`. */
async function runLens(id: string): Promise<{ readonly sent: readonly unknown[]; readonly result: Promise<unknown> }> {
    const stub = makeStubRpc();
    stub.responder = (method) => (method === "commands.getCommands" ? ["host.known"] : undefined);
    const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
    stub.fire("editor.didOpen", { uri: URI, languageId: "typescript", version: 1, text: "a\n" });
    namespace.languages.registerCodeLensProvider("typescript", {
        provideCodeLenses: () => [
            new CodeLens(new Range(new Position(0, 0), new Position(0, 0)), {
                command: id,
                title: "t",
                arguments: [],
            }) as never,
        ],
    });
    const list = (await stub.callRequest("languages.provideCodeLenses", {
        handle: 0,
        uri: URI,
        languageId: "typescript",
        version: 1,
    })) as { lenses: { cacheId: [number, number] }[] };
    const result = stub.callRequest("languages.executeCodeLensCommand", { handle: 0, cacheId: list.lenses[0].cacheId });
    await result.catch(() => undefined);
    return {
        sent: stub.requests.filter((r) => r.method === "commands.executeCommand").map((r) => r.params),
        result,
    };
}

describe("code lens command — what counts as known", () => {
    it("a command the host knows runs there", async () => {
        const { sent, result } = await runLens("host.known");
        await expect(result).resolves.toBeUndefined();
        expect(sent).toEqual([{ id: "host.known", args: [] }]);
    });

    it("an API command is not declared to the host and is still known", async () => {
        const { sent, result } = await runLens("vscode.open");
        // Known, so it runs here, and refuses for the lack of its argument.
        await expect(result).rejects.not.toThrow("not found");
        expect(sent).toEqual([]);
    });

    it("a command nobody knows is not found and is not sent", async () => {
        const { sent, result } = await runLens("nobody.knows");
        await expect(result).rejects.toThrow("command 'nobody.knows' not found");
        expect(sent).toEqual([]);
    });
});
