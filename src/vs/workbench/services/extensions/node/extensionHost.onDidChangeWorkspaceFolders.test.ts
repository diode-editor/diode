import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { WorkspaceFoldersExtensionAdapter } from "../../../api/browser/workspaceFoldersExtensionAdapter.ts";

const ID = "test.workspaceFoldersProbe";

/**
 * Upstream fires the event only for in-place folder changes of a multi-root workspace (WORKSPACE state);
 * from EMPTY/FOLDER every change re-enters the workspace and restarts the extension host
 * (abstractWorkspaceEditingService.ts). Single-root Diode restarts the subprocess on every change.
 */
async function setup() {
    // The sink is created before the harness it opens folders in.
    const late: { harness?: IExtensionHarness } = {};
    const sink = new WorkspaceFoldersExtensionAdapter(
        (folder) => void late.harness?.openFolder(folder),
        { show: () => ({ dispose: () => undefined }) as never },
        () => undefined,
    );
    const harness = await createExtensionTestHarness({
        extensions: [extensionFixture(ID, "workspaceFoldersProbe.cjs")],
        workspaceFoldersSink: sink,
    });
    late.harness = harness;
    const other = path.join(harness.tmpDir, "other");
    fs.mkdirSync(other);
    const journalPath = path.join(harness.tmpDir, "globalStorage", ID.toLowerCase(), "journal.txt");
    const journal = (): string[] =>
        fs.existsSync(journalPath) ? fs.readFileSync(journalPath, "utf-8").trim().split("\n") : [];
    return { harness, other, journal };
}

/**
 * The journal has one line per fact, `<what> <pid> <payload>`: the old process activated in `from`, never saw an
 * event, and a different process activated in `to`.
 */
async function expectRestartedWithoutEvent(journal: () => string[], from: string, to: string): Promise<void> {
    await expect.poll(journal).toHaveLength(4);
    const lines = journal().map((line) => line.split(" "));
    expect(lines.map((words) => words.toSpliced(1, 1).join(" "))).toEqual([
        `activate ${from}`,
        "disposable true",
        `activate ${to}`,
        "disposable true",
    ]);
    expect(lines[2]?.[1]).not.toBe(lines[0]?.[1]);
}

describe("ExtensionHost — workspace.onDidChangeWorkspaceFolders in single-root Diode", () => {
    it("[api:workspace.onDidChangeWorkspaceFolders] Open Folder: no event in the old subprocess, the restarted extension sees the new folder in activate()", async () => {
        const { harness, other, journal } = await setup();
        try {
            await expect.poll(journal).toHaveLength(2);
            await harness.openFolder(other);

            await expectRestartedWithoutEvent(journal, harness.tmpDir, other);
        } finally {
            await harness.dispose();
        }
    });

    it("[api:workspace.onDidChangeWorkspaceFolders] updateWorkspaceFolders onto one folder: true, no event, the restarted extension sees the new folder", async () => {
        const { harness, other, journal } = await setup();
        try {
            await expect(harness.commandRegistry.execute("test.replaceFolder", other)).resolves.toBe(true);

            await expectRestartedWithoutEvent(journal, harness.tmpDir, other);
        } finally {
            await harness.dispose();
        }
    });
});
