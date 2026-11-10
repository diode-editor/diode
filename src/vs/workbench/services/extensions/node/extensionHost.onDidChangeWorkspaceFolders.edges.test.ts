import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { WorkspaceFoldersExtensionAdapter } from "../../../api/browser/workspaceFoldersExtensionAdapter.ts";

const ID = "test.workspaceFoldersEdgeProbe";

async function setup() {
    const late: { harness?: IExtensionHarness } = {};
    const opened: string[] = [];
    const sink = new WorkspaceFoldersExtensionAdapter(
        (folder) => {
            opened.push(folder);
            void late.harness?.openFolder(folder);
        },
        { show: () => ({ dispose: () => undefined }) as never },
        () => undefined,
    );
    const harness = await createExtensionTestHarness({
        extensions: [extensionFixture(ID, "workspaceFoldersEdgeProbe.cjs")],
        workspaceFoldersSink: sink,
    });
    late.harness = harness;
    const journalPath = path.join(harness.tmpDir, "globalStorage", ID.toLowerCase(), "journal.txt");
    const journal = (): string[] =>
        fs.existsSync(journalPath) ? fs.readFileSync(journalPath, "utf-8").trim().split("\n") : [];
    const mkdir = (name: string): string => {
        const dir = path.join(harness.tmpDir, name);
        fs.mkdirSync(dir);
        return dir;
    };
    const update = (index: number, deleteCount: number, paths: string[]): Promise<unknown> =>
        harness.commandRegistry.execute("test.edge.update", index, deleteCount, paths);
    await expect.poll(journal).toHaveLength(1);
    return { harness, journal, mkdir, update, opened };
}

/** Journal lines without the pid. */
const facts = (lines: string[]): string[] => lines.map((line) => line.split(" ").toSpliced(1, 1).join(" "));

/** Gives a stray event or restart time to show up in the journal. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 500));

describe("ExtensionHost — workspace.onDidChangeWorkspaceFolders edges in single-root Diode", () => {
    it("[api:workspace.onDidChangeWorkspaceFolders] adding a second folder: false, folder kept, no restart, no event", async () => {
        const { harness, journal, mkdir, update, opened } = await setup();
        try {
            await expect(update(1, 0, [mkdir("second")])).resolves.toBe(false);
            await settle();

            expect(opened).toEqual([]);
            expect(facts(journal())).toEqual([`activate ${harness.tmpDir}`]);
            await expect(harness.commandRegistry.execute("test.edge.folders")).resolves.toBe(harness.tmpDir);
        } finally {
            await harness.dispose();
        }
    });

    it("[api:workspace.onDidChangeWorkspaceFolders] removing the only folder: false, no restart, no event", async () => {
        const { harness, journal, update, opened } = await setup();
        try {
            await expect(update(0, 1, [])).resolves.toBe(false);
            await settle();

            expect(opened).toEqual([]);
            expect(facts(journal())).toEqual([`activate ${harness.tmpDir}`]);
        } finally {
            await harness.dispose();
        }
    });

    it("[api:workspace.onDidChangeWorkspaceFolders] replacing the folder with itself: false as upstream (nothing changed), no restart, no event", async () => {
        const { harness, journal, update, opened } = await setup();
        try {
            await expect(update(0, 1, [harness.tmpDir])).resolves.toBe(false);
            await settle();

            expect(opened).toEqual([]);
            expect(facts(journal())).toEqual([`activate ${harness.tmpDir}`]);
        } finally {
            await harness.dispose();
        }
    });

    it("[api:workspace.onDidChangeWorkspaceFolders] subscription honours the Event contract: pushed into the disposables array, double dispose is harmless", async () => {
        const { harness } = await setup();
        try {
            await expect(harness.commandRegistry.execute("test.edge.subscribeContract")).resolves.toEqual({
                pushed: true,
                disposeType: "function",
            });
        } finally {
            await harness.dispose();
        }
    });

    it("[api:workspace.onDidChangeWorkspaceFolders] two folder switches in a row: every process sees its own folder, never an event", async () => {
        const { harness, journal, mkdir } = await setup();
        try {
            const a = mkdir("a");
            const b = mkdir("b");
            await harness.openFolder(a);
            await expect.poll(journal).toHaveLength(2);
            await harness.openFolder(b);
            await expect.poll(journal).toHaveLength(3);
            await settle();

            expect(facts(journal())).toEqual([`activate ${harness.tmpDir}`, `activate ${a}`, `activate ${b}`]);
            expect(new Set(journal().map((line) => line.split(" ")[1])).size).toBe(3);
        } finally {
            await harness.dispose();
        }
    });
});
