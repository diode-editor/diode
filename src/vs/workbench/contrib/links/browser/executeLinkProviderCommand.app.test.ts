import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";

// The workbench registers `_executeLinkProvider` at startup, before extensions, and it answers for the open file
// with the built-in URL detector.
describe("_executeLinkProvider in the workbench", () => {
    let ws: ITempWorkspace | undefined;
    let h: IAppHarness | undefined;

    afterEach(() => {
        h?.dispose();
        ws?.dispose();
    });

    it("answers the URL the built-in detector finds in the open file", async () => {
        ws = createTempWorkspace({ files: { "notes.md": "see https://example.com/x\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("notes.md") });

        await expect(
            h.commands.execute("_executeLinkProvider", Uri.file(ws.path("notes.md")).toJSON()),
        ).resolves.toEqual([{ range: createRange(0, 4, 0, 25), target: "https://example.com/x" }]);
    });
});
