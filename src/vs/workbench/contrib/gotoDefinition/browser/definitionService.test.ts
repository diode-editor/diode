import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type {
    DefinitionProvider,
    ICoreDefinitionLocation,
    IDefinitionRequest,
} from "../../../../editor/common/languages/iDefinitionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { DefinitionServiceDIToken } from "./definitionService.ts";

describe("DefinitionService — Go to Definition", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-gotodef-",
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
    let definitions: IDisposable | undefined;
    /** Единственный definition-провайдер для любого документа (снимает прежнего). */
    const useDefinitions = (provideDefinition: DefinitionProvider["provideDefinition"]): void => {
        definitions?.dispose();
        definitions = h.container
            .get(LanguageFeaturesServiceDIToken)
            .definitionProvider.register("*", { provideDefinition });
    };
    const service = () => h.container.get(DefinitionServiceDIToken);
    const caret = () => group().getActiveEditor()?.viewState.selections[0].active;

    it("прыжок в том же файле: каретка встаёт на начало цели", async () => {
        const mainUri = Uri.file(ws.path("main.ts")).toString();
        const seen: { request?: IDefinitionRequest } = {};
        useDefinitions((request) => {
            seen.request = request;
            return Promise.resolve([{ uri: mainUri, range: createRange(1, 6, 1, 11) }]);
        });

        await service().revealDefinition();

        expect(caret()).toMatchObject({ line: 1, character: 6 });
        // Запрос нёс полный снапшот и позицию каретки на момент вызова.
        expect(seen.request).toMatchObject({ uri: mainUri, line: 0, character: 0 });
        expect(seen.request?.text).toContain("const answer");
    });

    it("кросс-файловый прыжок: открывает другой файл и доводит каретку", async () => {
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        useDefinitions(() => Promise.resolve([{ uri: defsUri, range: createRange(0, 16, 0, 23) }]));

        await service().revealDefinition();

        expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
        expect(caret()).toMatchObject({ line: 0, character: 16 });
    });

    it("F12 из пользовательского состояния запускает прыжок", async () => {
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        useDefinitions(() => Promise.resolve([{ uri: defsUri, range: createRange(1, 4, 1, 10) }]));

        h.testApp.sendKey("F12");
        // Команда не ждётся: прокачиваем цепочку «реестр → провайдеры → открытие файла».
        await flushMicrotasks(10);

        expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
        expect(caret()).toMatchObject({ line: 1, character: 4 });
    });

    it("Ctrl+K F12 (revealDefinitionAside): цель открывается в соседней группе", async () => {
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        const mainUri = Uri.file(ws.path("main.ts")).toString();
        useDefinitions(() => Promise.resolve([{ uri: defsUri, range: createRange(0, 16, 0, 23) }]));

        h.commands.execute("editor.action.revealDefinitionAside");
        // Команда не ждётся: прокачиваем цепочку «реестр → провайдеры → открытие файла».
        await flushMicrotasks(10);

        // Цель — в группе справа; исходная группа не тронута.
        const groups = group().editorGroups.groups;
        expect(groups.length).toBe(2);
        expect(groups[0].activePane?.uri.toString()).toBe(mainUri);
        expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
        expect(caret()).toMatchObject({ line: 0, character: 16 });
    });

    /** Провайдер с ручным ответом: каждый вызов кладёт свой resolver в очередь. */
    function deferredSource(): ((locations: readonly ICoreDefinitionLocation[]) => void)[] {
        const pending: ((locations: readonly ICoreDefinitionLocation[]) => void)[] = [];
        useDefinitions(
            () =>
                new Promise((resolve) => {
                    pending.push(resolve);
                }),
        );
        return pending;
    }

    it("ответ после правки документа не прыгает", async () => {
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        const mainUri = Uri.file(ws.path("main.ts")).toString();
        const pending = deferredSource();

        const reveal = service().revealDefinition();
        h.testApp.sendKey("x");
        pending[0]([{ uri: defsUri, range: createRange(1, 4, 1, 10) }]);
        await reveal;

        expect(group().getActiveEditor()?.uri.toString()).toBe(mainUri);
        expect(caret()).toMatchObject({ line: 0, character: 1 });
    });

    it("ответ после ухода каретки не прыгает", async () => {
        const mainUri = Uri.file(ws.path("main.ts")).toString();
        const pending = deferredSource();

        const reveal = service().revealDefinition();
        group().getActiveEditor()?.goToPosition(1, 2);
        pending[0]([{ uri: mainUri, range: createRange(0, 6, 0, 12) }]);
        await reveal;

        expect(caret()).toMatchObject({ line: 1, character: 2 });
    });

    it("повторный F12 перебивает прежний: запоздавший первый ответ не прыгает", async () => {
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        const mainUri = Uri.file(ws.path("main.ts")).toString();
        const pending = deferredSource();

        const first = service().revealDefinition();
        const second = service().revealDefinition();
        pending[1]([{ uri: mainUri, range: createRange(1, 6, 1, 11) }]);
        await second;
        expect(caret()).toMatchObject({ line: 1, character: 6 });

        pending[0]([{ uri: defsUri, range: createRange(1, 4, 1, 10) }]);
        await first;
        expect(group().getActiveEditor()?.uri.toString()).toBe(mainUri);
        expect(caret()).toMatchObject({ line: 1, character: 6 });
    });

    it("нет источника / пустой результат / нет активного редактора — no-op", async () => {
        // Нет источника.
        await service().revealDefinition();
        expect(caret()).toMatchObject({ line: 0, character: 0 });

        // Пустой результат.
        useDefinitions(() => Promise.resolve([]));
        await service().revealDefinition();
        expect(caret()).toMatchObject({ line: 0, character: 0 });

        // Нет активного редактора: источник не должен вызываться вовсе.
        let called = false;
        useDefinitions(() => {
            called = true;
            return Promise.resolve([]);
        });
        h.commands.execute("workbench.action.closeActiveEditor");
        h.commands.execute("workbench.action.closeActiveEditor");
        expect(group().getActiveEditor()).toBeNull();
        await service().revealDefinition();
        expect(called).toBe(false);
    });
});
