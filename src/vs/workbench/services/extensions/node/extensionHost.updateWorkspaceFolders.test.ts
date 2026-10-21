import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { WorkspaceFoldersExtensionAdapter } from "../../../api/browser/workspaceFoldersExtensionAdapter.ts";
import type { INotificationMessage } from "../../notification/browser/notificationService.ts";

async function setup() {
    const opened: string[] = [];
    const shown: INotificationMessage[] = [];
    const sink = new WorkspaceFoldersExtensionAdapter(
        (folder) => opened.push(folder),
        {
            show: (message) => {
                shown.push(message);
                return { dispose: () => undefined } as never;
            },
        },
        (id) => (id === "test.updatesWorkspaceFolders" ? "Folder Probe" : undefined),
    );
    const harness = await createExtensionTestHarness({
        extensions: [extensionFixture("test.updatesWorkspaceFolders", "updatesWorkspaceFolders.cjs")],
        workspaceFoldersSink: sink,
    });
    return { harness, opened, shown };
}

describe("ExtensionHost — workspace.updateWorkspaceFolders through a real subprocess", () => {
    it("a second folder (golang.go's shape): false and an error toast on behalf of the extension", async () => {
        const { harness, opened, shown } = await setup();
        try {
            const other = path.join(harness.tmpDir, "other");
            await expect(harness.commandRegistry.execute("test.addFolder", other)).resolves.toBe(false);
            await expect
                .poll(() => shown.map((m) => m.message))
                .toEqual([
                    "Extension 'Folder Probe' failed to update workspace folders: multi-root workspaces are not supported",
                ]);
            expect(opened).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("replacing the only folder: true, and the host opens the new one", async () => {
        const { harness, opened, shown } = await setup();
        try {
            const other = path.join(harness.tmpDir, "other");
            await expect(harness.commandRegistry.execute("test.replaceFolder", other)).resolves.toBe(true);
            await expect.poll(() => opened).toEqual([other]);
            expect(shown).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
