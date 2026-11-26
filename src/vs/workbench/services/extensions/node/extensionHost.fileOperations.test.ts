import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";

const FIXTURE = extensionFixture("test.fileOperationEvents", "fileOperationEvents.cjs");

async function withHarness(run: (harness: IExtensionHarness) => Promise<void>): Promise<void> {
    const harness = await createExtensionTestHarness({
        initialFile: { name: "a.txt", content: "alpha" },
        extensions: [FIXTURE],
    });
    try {
        await settle();
        await run(harness);
    } finally {
        await harness.dispose();
    }
}

const execute = <T>(harness: IExtensionHarness, id: string, ...args: unknown[]): Promise<T> =>
    harness.commandRegistry.execute(id, ...args) as Promise<T>;

/** A `did` notification travels after the reply that may already have been awaited. */
async function logOf(harness: IExtensionHarness): Promise<string[]> {
    await settle();
    return execute<string[]>(harness, "test.fileOps.log");
}

describe("ExtensionHost — file operation events reach the extension", () => {
    it("[api:workspace.onWillRenameFiles] [api:workspace.onDidRenameFiles] applyEdit: will, then did, in order", async () => {
        await withHarness(async (harness) => {
            const from = path.join(harness.tmpDir, "a.txt");
            const to = path.join(harness.tmpDir, "b.txt");

            await expect(
                execute(harness, "test.fileOps.renameViaEdit", Uri.file(from).toString(), Uri.file(to).toString()),
            ).resolves.toBe(true);

            expect(await logOf(harness)).toEqual(["willRename a.txt>b.txt", "didRename a.txt>b.txt"]);
            expect(fs.existsSync(to)).toBe(true);
        });
    });

    it("[api:workspace.onWillRenameFiles] waitUntil's edit lands in the document before the rename, which keeps it", async () => {
        await withHarness(async (harness) => {
            const from = path.join(harness.tmpDir, "a.txt");
            const to = path.join(harness.tmpDir, "b.txt");
            const uri = Uri.file(from).toString();
            await execute(harness, "test.fileOps.insert", uri, "FOO");

            await execute(harness, "test.fileOps.renameViaEdit", uri, Uri.file(to).toString());
            await settle();

            const active = harness.group.getActiveEditor();
            expect(active?.uri.toString()).toBe(Uri.file(to).toString());
            expect(active?.getText()).toBe("FOOalpha");
            expect(active?.isModified).toBe(true);
        });
    });

    it("[api:workspace.onWillRenameFiles] an explorer rename and the edit in an open tab undo as one step, from the tab", async () => {
        await withHarness(async (harness) => {
            const open = path.join(harness.tmpDir, "a.txt");
            const from = harness.writeFile("b.txt", "B");
            const to = path.join(harness.tmpDir, "c.txt");
            await execute(harness, "test.fileOps.insert", Uri.file(open).toString(), "FOO");

            await harness.workspaceEditService.applyFileEdits([{ kind: "rename", from, to }], "Rename");
            await settle();

            const active = harness.group.getActiveEditor();
            expect(active?.getText()).toBe("FOOalpha");
            expect(fs.existsSync(to)).toBe(true);

            active?.model.undo();
            await settle();

            expect(active?.getText()).toBe("alpha");
            expect(fs.existsSync(from)).toBe(true);
            expect(fs.existsSync(to)).toBe(false);
        });
    });

    it("[api:workspace.onWillDeleteFiles] [api:workspace.onDidDeleteFiles] [api:workspace.onWillCreateFiles] [api:workspace.onDidCreateFiles] the explorer's create and delete reach the extension", async () => {
        await withHarness(async (harness) => {
            const target = path.join(harness.tmpDir, "new.txt");

            await harness.workspaceEditService.applyFileEdits([{ kind: "create", to: target }], "New File");
            expect(await logOf(harness)).toEqual(["willCreate new.txt", "didCreate new.txt"]);

            await harness.workspaceEditService.applyFileEdits([{ kind: "delete", from: target }], "Delete");
            expect(await logOf(harness)).toEqual(["willDelete new.txt", "didDelete new.txt"]);
        });
    });
});
