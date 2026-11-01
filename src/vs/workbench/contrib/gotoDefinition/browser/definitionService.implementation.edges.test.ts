import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ICoreDefinitionLocation } from "../../../../editor/common/languages/iDefinitionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { DefinitionServiceDIToken } from "./definitionService.ts";

describe("Go to Implementations — the request is pending", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-gotoimpl-edges-",
            files: {
                "main.ts": "interface Shape { area(): number }\n",
                "other.ts": "const other = 1;\n",
                "impl.ts": "class Circle {\n    area() { return 3; }\n}\n",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(100, 30) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("the user switches to another file: the late answer doesn't take them away from it", async () => {
        const group = h.container.get(EditorServiceDIToken);
        let answer: (targets: ICoreDefinitionLocation[]) => void = () => undefined;
        h.container.get(LanguageFeaturesServiceDIToken).implementationProvider.register("*", {
            provideImplementation: () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        });

        const run = h.container.get(DefinitionServiceDIToken).goToImplementation();
        h.workbench.openFile(ws.path("other.ts"));
        answer([{ uri: Uri.file(ws.path("impl.ts")).toString(), range: createRange(1, 4, 1, 8) }]);
        await run;
        await flushMicrotasks(10);

        // Upstream's EditorStateCancellationTokenSource cancels on onDidChangeModel.
        expect(group.getActiveEditor()?.uri.toString()).toBe(Uri.file(ws.path("other.ts")).toString());
    });
});
