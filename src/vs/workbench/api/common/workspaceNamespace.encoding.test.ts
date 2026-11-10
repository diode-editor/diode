import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

/** "Hellö" in windows-1252 and in utf-8. */
const CP1252 = new Uint8Array([72, 101, 108, 108, 0xf6]);
const UTF8 = new Uint8Array(Buffer.from("Hellö"));
const FOLDER = path.resolve("/work/project");
const USER_DATA = path.resolve("/home/u/User");

interface IInit {
    readonly user?: Record<string, unknown>;
    readonly folders?: readonly string[];
    readonly userRoamingDataHome?: unknown;
}

function makeWorkspace({ user = {}, folders = [Uri.file(FOLDER).toString()], userRoamingDataHome }: IInit = {}) {
    const stub = makeStubRpc();
    stub.responder = (method, params) =>
        method === "languages.getLanguageOfDocument"
            ? { languageId: String((params as { uri: string }).uri).endsWith(".txt") ? "plaintext" : null }
            : undefined;
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    const workspace = createWorkspaceNamespace(ctx);
    stub.fire("workspace.initialize", {
        configuration: { defaults: { files: { encoding: "utf8" } }, user },
        workspaceFolders: folders.map((uri, index) => ({ uri, name: `f${index}`, index })),
        ...(userRoamingDataHome === undefined ? {} : { userRoamingDataHome }),
    });
    const languageRequests = (): unknown[] =>
        stub.requests.filter((r) => r.method === "languages.getLanguageOfDocument").map((r) => r.params);
    return { workspace, languageRequests };
}

const CP1252_USER = { files: { encoding: "windows1252" } };

describe("WorkspaceNamespace — decode / encode", () => {
    it("[api:workspace.decode] the user setting applies without options; no uri asks for no language", async () => {
        const { workspace, languageRequests } = makeWorkspace({ user: CP1252_USER });
        expect(await workspace.decode(CP1252)).toBe("Hellö");
        expect(languageRequests()).toEqual([]);
    });

    it("[api:workspace.decode] a uri asks for its language; the language section of files.encoding wins", async () => {
        const { workspace, languageRequests } = makeWorkspace({
            user: { "[plaintext]": { "files.encoding": "cp1252" } },
        });
        const uri = Uri.file(path.join(FOLDER, "a.txt"));
        expect(await workspace.decode(CP1252, { uri })).toBe("Hellö");
        expect(languageRequests()).toEqual([{ uri: uri.toString() }]);
        expect(await workspace.decode(UTF8, { uri: Uri.file(path.join(FOLDER, "a.md")) })).toBe("Hellö");
    });

    it("[api:workspace.encode] encode returns a Node Buffer in the configured encoding", async () => {
        const { workspace } = makeWorkspace({ user: CP1252_USER });
        const encoded = await workspace.encode("Hellö");
        expect(Buffer.isBuffer(encoded)).toBe(true);
        expect([...encoded]).toEqual([...CP1252]);
        expect([...(await workspace.encode("Hellö", { encoding: "utf8" }))]).toEqual([...UTF8]);
    });

    it("[api:workspace.decode] options of the wrong shape are ignored, as upstream's toEncodeDecodeParameters", async () => {
        const { workspace, languageRequests } = makeWorkspace({ user: CP1252_USER });
        const decode = workspace.decode as (content: Uint8Array, options?: unknown) => Thenable<string>;
        for (const options of [null, 7, { encoding: "" }, { encoding: 8 }, { uri: "file:///x/a.txt" }]) {
            expect(await decode(CP1252, options), JSON.stringify(options)).toBe("Hellö");
        }
        expect(languageRequests()).toEqual([]);
        expect(await decode(CP1252, { encoding: "utf8" })).toBe("Hell�");
    });

    it("[api:workspace.decode] the user data directory from workspace.initialize is utf-8; a non-string is none", async () => {
        const file = { uri: Uri.file(path.join(USER_DATA, "settings.json")) };
        const withHome = makeWorkspace({ user: CP1252_USER, userRoamingDataHome: USER_DATA });
        expect(await withHome.workspace.decode(UTF8, file)).toBe("Hellö");
        const garbage = makeWorkspace({ user: CP1252_USER, userRoamingDataHome: 42 });
        expect(await garbage.workspace.decode(CP1252, file)).toBe("Hellö");
    });

    it("[api:workspace.decode] .vscode/ of a file folder is utf-8, of a folder on another scheme it is not", async () => {
        const settings = { uri: Uri.file(path.join(FOLDER, ".vscode", "settings.json")) };
        const onDisk = makeWorkspace({ user: CP1252_USER });
        expect(await onDisk.workspace.decode(UTF8, settings)).toBe("Hellö");
        const virtual = makeWorkspace({
            user: CP1252_USER,
            folders: [Uri.file(FOLDER).with({ scheme: "memfs" }).toString()],
        });
        expect(await virtual.workspace.decode(CP1252, settings)).toBe("Hellö");
    });
});
