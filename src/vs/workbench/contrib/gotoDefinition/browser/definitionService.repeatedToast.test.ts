import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";

import { DefinitionServiceDIToken } from "./definitionService.ts";

describe("DefinitionService — repeated F12 with no targets", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-gotodef-toast-", files: { "main.ts": "const answer = 1;\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(100, 40) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    // Upstream replaces the message at the cursor, and its notification model closes an identical live notification.
    it("shows one toast on the frame, not one per key press", async () => {
        h.container
            .get(LanguageFeaturesServiceDIToken)
            .definitionProvider.register("*", { provideDefinition: () => Promise.resolve([]) });
        const service = h.container.get(DefinitionServiceDIToken);

        await service.revealDefinition();
        await service.revealDefinition();
        await service.revealDefinition();

        h.testApp.render();
        const shown = h.testApp.backend.screenToString().split("No definition found for 'const'").length - 1;
        expect(shown).toBe(1);
    });
});
