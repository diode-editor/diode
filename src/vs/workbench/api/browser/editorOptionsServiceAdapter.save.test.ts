import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import type { IBulkEditService } from "../../contrib/bulkEdit/common/iBulkEditService.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";

import { EditorOptionsServiceAdapter } from "./editorOptionsServiceAdapter.ts";

const NO_BULK_EDITS: IBulkEditService = { applyWorkspaceEdit: () => Promise.resolve(false) };
const MAIN = Uri.file("/proj/main.go");

function createAdapter(fake: Partial<IEditorService>): EditorOptionsServiceAdapter {
    const editors = fake as IEditorService;
    return new EditorOptionsServiceAdapter(editors, editors as unknown as IEditorGroupsService, NO_BULK_EDITS);
}

describe("EditorOptionsServiceAdapter.saveAll / save", () => {
    it("saveAll: includeUntitled — опцией сервиса, ответ — его вердикт", async () => {
        const saveAll = vi.fn(() => Promise.resolve(false));
        const adapter = createAdapter({ saveAll });

        await expect(adapter.saveAll(true)).resolves.toBe(false);
        await adapter.saveAll(false);

        expect(saveAll.mock.calls).toStrictEqual([[{ includeUntitled: true }], [{ includeUntitled: false }]]);
    });

    it("save: строка ресурса — в Uri и обратно; не сохранён — null", async () => {
        const save = vi.fn((resource: Uri) => Promise.resolve(resource.path === MAIN.path ? resource : undefined));
        const adapter = createAdapter({ save });

        await expect(adapter.save(MAIN.toString())).resolves.toBe(MAIN.toString());
        expect(save.mock.calls[0]?.[0].toString()).toBe(MAIN.toString());
        await expect(adapter.save(Uri.file("/proj/other.go").toString())).resolves.toBeNull();
    });
});
