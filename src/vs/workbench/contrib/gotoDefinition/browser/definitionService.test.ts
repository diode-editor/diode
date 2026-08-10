import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IDefinitionRequest } from "../../../../editor/common/languages/iDefinitionSource.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { DefinitionServiceDIToken } from "./definitionService.ts";

describe("DefinitionService — Go to Definition", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "vexx-gotodef-",
            files: {
                "main.ts": "const answer = compute();\nconst other = 1;\n",
                "defs.ts": "export function compute(): number {\n    return 42;\n}\n",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const group = () => h.container.get(EditorServiceDIToken);
    const service = () => h.container.get(DefinitionServiceDIToken);
    const caret = () => group().getActiveEditor()?.viewState.selections[0].active;

    it("прыжок в том же файле: каретка встаёт на начало цели", async () => {
        const mainUri = Uri.file(ws.path("main.ts")).toString();
        const seen: { request?: IDefinitionRequest } = {};
        group().definitionSource = (request) => {
            seen.request = request;
            return Promise.resolve([{ uri: mainUri, range: createRange(1, 6, 1, 11) }]);
        };

        await service().revealDefinition();

        expect(caret()).toMatchObject({ line: 1, character: 6 });
        // Запрос нёс полный снапшот и позицию каретки на момент вызова.
        expect(seen.request).toMatchObject({ uri: mainUri, line: 0, character: 0 });
        expect(seen.request?.text).toContain("const answer");
    });

    it("кросс-файловый прыжок: открывает другой файл и доводит каретку", async () => {
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        group().definitionSource = () => Promise.resolve([{ uri: defsUri, range: createRange(0, 16, 0, 23) }]);

        await service().revealDefinition();

        expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
        expect(caret()).toMatchObject({ line: 0, character: 16 });
    });

    it("F12 из пользовательского состояния запускает прыжок", async () => {
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        group().definitionSource = () => Promise.resolve([{ uri: defsUri, range: createRange(1, 4, 1, 10) }]);

        h.testApp.sendKey("F12");
        await flushMicrotasks();

        expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
        expect(caret()).toMatchObject({ line: 1, character: 4 });
    });

    it("Ctrl+K F12 (revealDefinitionAside): цель открывается в соседней группе", async () => {
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        const mainUri = Uri.file(ws.path("main.ts")).toString();
        group().definitionSource = () => Promise.resolve([{ uri: defsUri, range: createRange(0, 16, 0, 23) }]);

        h.commands.execute("editor.action.revealDefinitionAside");
        await flushMicrotasks();

        // Цель — в группе справа; исходная группа не тронута.
        const groups = group().groups;
        expect(groups.length).toBe(2);
        expect(groups[0].activePane?.uri.toString()).toBe(mainUri);
        expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
        expect(caret()).toMatchObject({ line: 0, character: 16 });
    });

    it("нет источника / пустой результат / нет активного редактора — no-op", async () => {
        // Нет источника.
        await service().revealDefinition();
        expect(caret()).toMatchObject({ line: 0, character: 0 });

        // Пустой результат.
        group().definitionSource = () => Promise.resolve([]);
        await service().revealDefinition();
        expect(caret()).toMatchObject({ line: 0, character: 0 });

        // Нет активного редактора: источник не должен вызываться вовсе.
        let called = false;
        group().definitionSource = () => {
            called = true;
            return Promise.resolve([]);
        };
        h.commands.execute("workbench.action.closeActiveEditor");
        h.commands.execute("workbench.action.closeActiveEditor");
        expect(group().getActiveEditor()).toBeNull();
        await service().revealDefinition();
        expect(called).toBe(false);
    });
});
