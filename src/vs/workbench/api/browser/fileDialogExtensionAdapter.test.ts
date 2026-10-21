import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import type { IFileDialogService } from "../../services/dialogs/browser/fileDialogService.ts";
import type { IOpenDialogOptions, ISaveDialogOptions } from "../../services/dialogs/browser/simpleFileDialog.ts";

import { FileDialogExtensionAdapter } from "./fileDialogExtensionAdapter.ts";

function setup(answers: { open?: Uri[]; save?: Uri }) {
    const opens: IOpenDialogOptions[] = [];
    const saves: ISaveDialogOptions[] = [];
    const service: IFileDialogService = {
        showOpenDialog: (options) => {
            opens.push(options ?? {});
            return Promise.resolve(answers.open);
        },
        showSaveDialog: (options) => {
            saves.push(options ?? {});
            return Promise.resolve(answers.save);
        },
    };
    return { adapter: new FileDialogExtensionAdapter(service), opens, saves };
}

describe("FileDialogExtensionAdapter", () => {
    it("open: extension options go to the dialog, the selection comes back as Uri strings", async () => {
        const { adapter, opens } = setup({ open: [Uri.file("/ws/a.go")] });
        const picked = await adapter.showOpenDialog({
            title: "T",
            defaultUri: "file:///ws",
            openLabel: "Select",
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            filters: [{ name: "Go", extensions: ["go"] }],
        });
        expect(picked).toEqual(["file:///ws/a.go"]);
        expect(opens).toEqual([
            {
                title: "T",
                defaultUri: Uri.file("/ws"),
                openLabel: "Select",
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: true,
                filters: [{ name: "Go", extensions: ["go"] }],
            },
        ]);
    });

    it("cancel gives undefined; a non-file: defaultUri is dropped", async () => {
        const { adapter, opens } = setup({});
        await expect(adapter.showOpenDialog({ defaultUri: "untitled:Untitled-1" })).resolves.toBeUndefined();
        expect(opens[0]?.defaultUri).toBeUndefined();
    });

    it("save: the resource as a string or undefined", async () => {
        const { adapter, saves } = setup({ save: Uri.file("/ws/new.txt") });
        await expect(
            adapter.showSaveDialog({ defaultUri: "file:///ws/new.txt", saveLabel: "Save", title: "T", filters: [] }),
        ).resolves.toBe("file:///ws/new.txt");
        expect(saves).toEqual([{ title: "T", defaultUri: Uri.file("/ws/new.txt"), saveLabel: "Save", filters: [] }]);

        const none = setup({});
        await expect(none.adapter.showSaveDialog({})).resolves.toBeUndefined();
    });
});
