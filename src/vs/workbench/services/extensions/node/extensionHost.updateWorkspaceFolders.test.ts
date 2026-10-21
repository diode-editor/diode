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

describe("ExtensionHost — workspace.updateWorkspaceFolders через настоящий субпроцесс", () => {
    it("вторая папка (форма golang.go): false и тост ошибки от имени расширения", async () => {
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

    it("замена единственной папки: true, и хост открывает новую", async () => {
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
