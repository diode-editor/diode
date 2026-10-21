import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { DefinitionProvider } from "../../../../editor/common/languages/iDefinitionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { HistoryServiceDIToken } from "../../../services/history/browser/historyService.ts";

import { DefinitionServiceDIToken } from "./definitionService.ts";

// A non-disk `jdt:` target from the stock `redhat.java` extension: such a jump used to crash the process,
// `TextFileModel.openFile` threw on a non-file scheme and nobody awaited the command's promise.

/** Percent-encoded query, as from jdt.ls: comparing against the tab's resource string broke on this. */
const JDT_TARGET =
    "jdt://contents/commons-lang3-3.14.0.jar/org.apache.commons.lang3/StringUtils.java" +
    "?=mvn-proj/%5C/home%5C/vscode%5C/.m2%5C/repository%3D/maven.pomderived=/true";

const JDT_SOURCE = "package org.apache.commons.lang3;\n\npublic class StringUtils {\n    // capitalize\n}\n";

describe("DefinitionService — цель на недисковом ресурсе", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-gotodef-virtual-",
            files: { "App.java": "class App {\n    void run() {}\n}\n" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("App.java"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const group = () => h.container.get(EditorServiceDIToken);
    let definitions: IDisposable | undefined;
    const useDefinitions = (provideDefinition: DefinitionProvider["provideDefinition"]): void => {
        definitions?.dispose();
        definitions = h.container
            .get(LanguageFeaturesServiceDIToken)
            .definitionProvider.register("*", { provideDefinition });
    };
    const service = () => h.container.get(DefinitionServiceDIToken);
    const caret = () => group().getActiveEditor()?.viewState.selections[0].active;

    it("открывает read-only вкладку с исходником из jar и доводит каретку до цели", async () => {
        group().virtualDocumentSource = {
            canProvide: (scheme) => scheme === "jdt",
            provide: () => Promise.resolve(JDT_SOURCE),
        };
        useDefinitions(() => Promise.resolve([{ uri: JDT_TARGET, range: createRange(2, 13, 2, 24) }]));

        await service().revealDefinition();

        const editor = group().getActiveEditor();
        expect(editor?.uri.scheme).toBe("jdt");
        expect(editor?.getText()).toBe(JDT_SOURCE);
        expect(editor?.readOnly).toBe(true);
        // Exactly the line the server named: this is why the jump waits for the
        // provider's content instead of opening the tab "sometime later".
        expect(caret()).toMatchObject({ line: 2, character: 13 });
    });

    it("F12 с живым провайдером не роняет процесс и доезжает до цели", async () => {
        group().virtualDocumentSource = {
            canProvide: () => true,
            provide: () => Promise.resolve(JDT_SOURCE),
        };
        useDefinitions(() => Promise.resolve([{ uri: JDT_TARGET, range: createRange(0, 8, 0, 20) }]));

        h.testApp.sendKey("F12");
        // The command isn't awaited: pump the registry → providers → file open chain.
        await flushMicrotasks(10);

        expect(group().getActiveEditor()?.uri.scheme).toBe("jdt");
        expect(caret()).toMatchObject({ line: 0, character: 8 });
    });

    it("провайдера схемы нет — F12 сообщает человеку и оставляет исходный файл", async () => {
        const failures: string[] = [];
        group().onDidFailOpen(({ reason }) => failures.push(reason));
        useDefinitions(() => Promise.resolve([{ uri: JDT_TARGET, range: createRange(2, 13, 2, 24) }]));

        h.testApp.sendKey("F12");
        // The command isn't awaited: pump the registry → providers → file open chain.
        await flushMicrotasks(10);

        expect(group().editorGroups.activeGroup.editorCount).toBe(1);
        expect(group().getActiveEditor()?.uri.scheme).toBe("file");
        // The cursor stayed put: foreign coordinates didn't leak into our file.
        expect(caret()).toMatchObject({ line: 0, character: 0 });
        expect(failures).toHaveLength(1);
        service();
    });

    it("прыжок кладёт в историю обе точки, и Go Back/Forward ходят между ними", async () => {
        group().virtualDocumentSource = {
            canProvide: (scheme) => scheme === "jdt",
            provide: () => Promise.resolve(JDT_SOURCE),
        };
        useDefinitions(() => Promise.resolve([{ uri: JDT_TARGET, range: createRange(2, 13, 2, 24) }]));
        const appUri = Uri.file(ws.path("App.java")).toString();
        group().getActiveEditor()?.goToPosition(1, 4);

        await service().revealDefinition();
        const history = h.container.get(HistoryServiceDIToken);

        // Exactly two entries: where we jumped from and where to. There must be no
        // intermediate "opened the resource at the top"; that's jumpAsync's job, which
        // records the destination only AFTER the provider responds.
        expect(history.getEntries().map((e) => e.uri.scheme)).toEqual(["file", "jdt"]);
        expect(history.getEntries()[0]).toMatchObject({ line: 1, character: 4 });
        expect(history.getEntries()[1]).toMatchObject({ line: 2, character: 13 });

        history.goBack();
        expect(group().getActiveEditor()?.uri.toString()).toBe(appUri);
        expect(caret()).toMatchObject({ line: 1, character: 4 });

        // Going back to the source from the jar is synchronous too: the tab is open, and
        // nobody bothers the provider again for it.
        history.goForward();
        expect(group().getActiveEditor()?.uri.scheme).toBe("jdt");
        expect(caret()).toMatchObject({ line: 2, character: 13 });
    });

    it("цель в АКТИВНОМ редакторе не переоткрывается, но каретка доезжает", async () => {
        const provide = vi.fn<() => Promise<string | null>>().mockResolvedValue(JDT_SOURCE);
        group().virtualDocumentSource = { canProvide: () => true, provide };
        useDefinitions(() => Promise.resolve([{ uri: JDT_TARGET, range: createRange(2, 13, 2, 24) }]));
        await service().revealDefinition();
        expect(provide).toHaveBeenCalledTimes(1);

        // The second F12 is already INSIDE the jar source, targeting that same source: the tab is looked up
        // by resource and reused, and the provider isn't bothered for it.
        group().getActiveEditor()?.goToPosition(0, 0);
        await service().revealDefinition();

        expect(provide).toHaveBeenCalledTimes(1);
        expect(group().editorGroups.activeGroup.editorCount).toBe(2);
        expect(caret()).toMatchObject({ line: 2, character: 13 });
    });

    it("активного редактора нет — прыжок не падает и ничего не открывает", async () => {
        group().virtualDocumentSource = {
            canProvide: () => true,
            provide: () => Promise.resolve(JDT_SOURCE),
        };
        const source = () => Promise.resolve([{ uri: JDT_TARGET, range: createRange(2, 13, 2, 24) }]);
        useDefinitions(source);

        // No tabs, so there's nothing to ask definition providers about.
        h.commands.execute("workbench.action.closeActiveEditor");
        expect(group().getActiveEditor()).toBeNull();
        await expect(service().revealDefinition()).resolves.toBeUndefined();

        expect(group().editorGroups.activeGroup.editorCount).toBe(0);
    });

    it("Ctrl+K F12 в недисковую цель открывает её в соседней группе", async () => {
        group().virtualDocumentSource = {
            canProvide: () => true,
            provide: () => Promise.resolve(JDT_SOURCE),
        };
        useDefinitions(() => Promise.resolve([{ uri: JDT_TARGET, range: createRange(2, 13, 2, 24) }]));

        await service().revealDefinition({ toSide: true });

        expect(group().editorGroups.groups.length).toBe(2);
        expect(group().getActiveEditor()?.uri.scheme).toBe("jdt");
        expect(caret()).toMatchObject({ line: 2, character: 13 });
    });
});
