import { describe, expect, it } from "vitest";

import type { INotificationMessage } from "../../services/notification/browser/notificationService.ts";

import { WorkspaceFoldersExtensionAdapter } from "./workspaceFoldersExtensionAdapter.ts";

function setup(names: Record<string, string> = {}) {
    const opened: string[] = [];
    const shown: INotificationMessage[] = [];
    const adapter = new WorkspaceFoldersExtensionAdapter(
        (folder) => opened.push(folder),
        {
            show: (message) => {
                shown.push(message);
                return { dispose: () => undefined } as never;
            },
        },
        (id) => names[id],
    );
    return { adapter, opened, shown };
}

describe("WorkspaceFoldersExtensionAdapter", () => {
    it("ровно одна папка — открывается, тоста нет", () => {
        const { adapter, opened, shown } = setup();
        adapter.update({ extensionId: "golang.go", folders: ["/ws/b"] });
        expect(opened).toEqual(["/ws/b"]);
        expect(shown).toEqual([]);
    });

    it("вторая папка — тост ошибки с формулировкой эталона и именем расширения", () => {
        const { adapter, opened, shown } = setup({ "golang.go": "Go" });
        adapter.update({ extensionId: "golang.go", folders: ["/ws/a", "/ws/b"] });
        expect(opened).toEqual([]);
        expect(shown).toEqual([
            {
                severity: "error",
                message: "Extension 'Go' failed to update workspace folders: multi-root workspaces are not supported",
                modal: false,
                items: [],
            },
        ]);
    });

    it("пустой итог — тоже отказ; без имени — id, без id — «unknown»", () => {
        const { adapter, opened, shown } = setup();
        adapter.update({ extensionId: "pub.ext", folders: [] });
        adapter.update({ extensionId: null, folders: ["/a", "/b"] });
        expect(opened).toEqual([]);
        expect(shown.map((m) => m.message)).toEqual([
            "Extension 'pub.ext' failed to update workspace folders: multi-root workspaces are not supported",
            "Extension 'unknown' failed to update workspace folders: multi-root workspaces are not supported",
        ]);
    });
});
