import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { RelativePattern, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

let tmpRoot: string;

beforeEach(() => {
    tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-find-")));
});

afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function layout(root: string, files: Record<string, string>): string {
    for (const [rel, content] of Object.entries(files)) {
        const target = path.join(root, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    return root;
}

/** `configuration` is a NESTED tree, as the host sends it, not flat dotted keys. */
function makeWorkspace(
    folders: readonly string[],
    configuration: Record<string, unknown> = {},
): typeof vscode.workspace & { setConfiguration(next: Record<string, unknown>): void } {
    const stub = makeStubRpc();
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
        configuration: { defaults: {}, user: configuration },
        workspaceFolders: folders.map((folder, index) => ({
            uri: Uri.file(folder).toString(),
            name: path.basename(folder),
            index,
        })),
    });
    return Object.assign(workspace, {
        setConfiguration: (next: Record<string, unknown>): void => {
            stub.fire("workspace.configurationChanged", {
                configuration: { defaults: {}, user: next },
                affectedKeys: [],
            });
        },
    });
}

const FILES_EXCLUDE_SNAPSHOT = { files: { exclude: { "**/.git": true, "**/node_modules": true } } };

function relative(root: string, uris: readonly vscode.Uri[]): string[] {
    return uris.map((uri) => path.relative(root, (uri as unknown as Uri).fsPath)).toSorted();
}

describe("workspace.findFiles — GlobPattern parsing", () => {
    it("a string pattern searches ALL workspace folders", async () => {
        const a = layout(path.join(tmpRoot, "a"), { "pom.xml": "", "src/App.java": "" });
        const b = layout(path.join(tmpRoot, "b"), { "pom.xml": "" });
        const workspace = makeWorkspace([a, b]);

        const found = await workspace.findFiles("**/pom.xml");

        expect(relative(tmpRoot, found)).toEqual([path.join("a", "pom.xml"), path.join("b", "pom.xml")]);
    });

    it("RelativePattern narrows the search to its base", async () => {
        const a = layout(path.join(tmpRoot, "a"), { "pom.xml": "" });
        const b = layout(path.join(tmpRoot, "b"), { "pom.xml": "" });
        const workspace = makeWorkspace([a, b]);

        const found = await workspace.findFiles(new RelativePattern(Uri.file(b) as never, "*.xml") as never);

        expect(relative(tmpRoot, found)).toEqual([path.join("b", "pom.xml")]);
    });

    it("the result is absolute file: Uris", async () => {
        const root = layout(tmpRoot, { "pom.xml": "" });
        const workspace = makeWorkspace([root]);

        const found = await workspace.findFiles("**/pom.xml");

        expect(found).toHaveLength(1);
        expect((found[0] as unknown as Uri).scheme).toBe("file");
        expect((found[0] as unknown as Uri).fsPath).toBe(path.join(root, "pom.xml"));
    });

    it("without open folders — an empty result, as in the contract", async () => {
        const workspace = makeWorkspace([]);
        await expect(workspace.findFiles("**/pom.xml")).resolves.toEqual([]);
    });

    it("a garbage pattern does not break the call", async () => {
        const workspace = makeWorkspace([layout(tmpRoot, { "pom.xml": "" })]);
        await expect(workspace.findFiles({ nonsense: true } as never)).resolves.toEqual([]);
    });
});

describe("workspace.findFiles — exclude", () => {
    const tree = { "pom.xml": "", "node_modules/dep/pom.xml": "", ".git/pom.xml": "", "web/pom.xml": "" };

    it("undefined — the files.exclude setting patterns", async () => {
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root], FILES_EXCLUDE_SNAPSHOT);

        const found = await workspace.findFiles("**/pom.xml");

        expect(relative(root, found)).toEqual(["pom.xml", path.join("web", "pom.xml")]);
    });

    it("undefined with an empty setting — no exclusions", async () => {
        // Defaults live in the setting, not in the traversal code: a snapshot without
        // `files.exclude` means "exclude nothing", not "use some defaults of our own".
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root]);

        const found = await workspace.findFiles("**/pom.xml");

        expect(relative(root, found)).toContain(path.join("node_modules", "dep", "pom.xml"));
    });

    it("search.exclude is NOT in the defaults — per the contract", async () => {
        // "default file-excludes (e.g. the `files.exclude`-setting but not
        // `search.exclude`)": the extension looks for a file in order to work with it.
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root], { search: { exclude: { "**/web": true } } });

        const found = await workspace.findFiles("**/pom.xml");

        expect(relative(root, found)).toContain(path.join("web", "pom.xml"));
    });

    it("a setting change applies to the very next call", async () => {
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root], FILES_EXCLUDE_SNAPSHOT);
        expect(relative(root, await workspace.findFiles("**/pom.xml"))).not.toContain(
            path.join("node_modules", "dep", "pom.xml"),
        );

        workspace.setConfiguration({ files: { exclude: { "**/.git": true, "**/node_modules": false } } });

        expect(relative(root, await workspace.findFiles("**/pom.xml"))).toContain(
            path.join("node_modules", "dep", "pom.xml"),
        );
    });

    it("null excludes nothing", async () => {
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root], FILES_EXCLUDE_SNAPSHOT);

        const found = await workspace.findFiles("**/pom.xml", null);

        expect(relative(root, found)).toContain(path.join("node_modules", "dep", "pom.xml"));
    });

    it("an explicit pattern REPLACES the defaults rather than adding to them", async () => {
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root], FILES_EXCLUDE_SNAPSHOT);

        const found = await workspace.findFiles("**/pom.xml", "**/web/**");

        // `web` is cut by the given pattern, but `node_modules` is not: the default is lifted.
        expect(relative(root, found)).toEqual([
            path.join(".git", "pom.xml"),
            path.join("node_modules", "dep", "pom.xml"),
            "pom.xml",
        ]);
    });

    it("a garbage exclude excludes nothing instead of failing", async () => {
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root], FILES_EXCLUDE_SNAPSHOT);

        // An object without `pattern` cannot be parsed. Treat it as "no excludes":
        // dropping the whole result would be worse than a silently missing filter.
        const found = await workspace.findFiles("**/pom.xml", { nonsense: true } as never);

        expect(relative(root, found)).toContain(path.join("node_modules", "dep", "pom.xml"));
    });

    it("RelativePattern in exclude is taken by its pattern", async () => {
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root]);

        const found = await workspace.findFiles(
            "**/pom.xml",
            new RelativePattern(Uri.file(root) as never, "**/web/**") as never,
        );

        expect(relative(root, found)).not.toContain(path.join("web", "pom.xml"));
    });
});

describe("workspace.findFiles — maxResults and cancellation", () => {
    it("maxResults counts across all folders together", async () => {
        const a = layout(path.join(tmpRoot, "a"), { "pom.xml": "" });
        const b = layout(path.join(tmpRoot, "b"), { "pom.xml": "" });
        const workspace = makeWorkspace([a, b]);

        const found = await workspace.findFiles("**/pom.xml", null, 1);

        expect(relative(tmpRoot, found)).toEqual([path.join("a", "pom.xml")]);
    });

    it("maxResults: 1 — the typical redhat.java query 'is there at least one build file'", async () => {
        const root = layout(tmpRoot, { "web/pom.xml": "", "core/pom.xml": "" });
        const workspace = makeWorkspace([root]);

        await expect(workspace.findFiles("**/pom.xml", null, 1)).resolves.toHaveLength(1);
    });

    it("an already cancelled token gives an empty result", async () => {
        const root = layout(tmpRoot, { "pom.xml": "" });
        const workspace = makeWorkspace([root]);
        const source = new CancellationTokenSource();
        source.cancel();

        const found = await workspace.findFiles("**/pom.xml", null, undefined, source.token as never);

        expect(found).toEqual([]);
    });

    it("a live token does not interfere with the search", async () => {
        const root = layout(tmpRoot, { "pom.xml": "" });
        const workspace = makeWorkspace([root]);
        const source = new CancellationTokenSource();

        const found = await workspace.findFiles("**/pom.xml", null, undefined, source.token as never);

        expect(found).toHaveLength(1);
    });
});
