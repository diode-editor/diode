import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type {
    ICoreRenameLocation,
    ICoreRenameResult,
    IRenameRequest,
} from "../../../../editor/common/languages/iRenameSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";

describe("renameActions — команда Rename Symbol", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-rename-actions-",
            files: { "main.ts": "const value = 1;\n" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("editor.action.rename доходит до провайдера под кареткой", async () => {
        const prepareRename = vi.fn(
            (request: IRenameRequest): Promise<ICoreRenameLocation> =>
                Promise.resolve({ kind: "name", name: request.text.slice(6, 11) }),
        );
        h.container.get(LanguageFeaturesServiceDIToken).renameProvider.register("*", {
            prepareRename,
            provideRenameEdits: (): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }),
        });

        h.commands.execute("editor.action.rename");
        await flushMicrotasks();

        // Провайдера спросили о позиции каретки — значит, команда дошла до
        // сервиса, а не осталась пустой регистрацией.
        expect(prepareRename).toHaveBeenCalledTimes(1);
        expect(prepareRename.mock.calls[0][0]).toMatchObject({ line: 0, character: 0 });
    });
});
