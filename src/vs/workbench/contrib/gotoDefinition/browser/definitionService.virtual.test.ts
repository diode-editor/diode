import type { IDisposable } from "@tuidom/core/common/disposable";
import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { DefinitionProvider } from "../../../../editor/common/languages/iDefinitionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { HistoryServiceDIToken } from "../../../services/history/browser/historyService.ts";

import { DefinitionServiceDIToken } from "./definitionService.ts";

/**
 * Go to Definition в **недисковый** ресурс — путь стокового `redhat.java`:
 * F12 на классе из jar возвращает `jdt:`-цель, содержимое которой отдаёт
 * `registerTextDocumentContentProvider` расширения.
 *
 * До этого такой прыжок убивал редактор целиком: `TextFileModel.openFile`
 * бросал на не-file схеме, промис команды никто не ждал, Node клал процесс.
 */

/**
 * Цель в том виде, в каком её присылает jdt.ls: query с процентным
 * кодированием. Нормализация `Uri` переписывает эту строку, поэтому сравнивать
 * ответ провайдера со строкой ресурса вкладки НЕЛЬЗЯ — на этом ломался прыжок.
 */
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
    /** Единственный definition-провайдер для любого документа (снимает прежнего). */
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
        // Ровно та строка, которую назвал сервер, — вот ради чего прыжок ждёт
        // содержимого провайдера, а не открывает вкладку «когда-нибудь потом».
        expect(caret()).toMatchObject({ line: 2, character: 13 });
    });

    it("F12 с живым провайдером не роняет процесс и доезжает до цели", async () => {
        group().virtualDocumentSource = {
            canProvide: () => true,
            provide: () => Promise.resolve(JDT_SOURCE),
        };
        useDefinitions(() => Promise.resolve([{ uri: JDT_TARGET, range: createRange(0, 8, 0, 20) }]));

        h.testApp.sendKey("F12");
        // Команда не ждётся: прокачиваем цепочку «реестр → провайдеры → открытие файла».
        await flushMicrotasks(10);

        expect(group().getActiveEditor()?.uri.scheme).toBe("jdt");
        expect(caret()).toMatchObject({ line: 0, character: 8 });
    });

    it("провайдера схемы нет — F12 сообщает человеку и оставляет исходный файл", async () => {
        const failures: string[] = [];
        group().onDidFailOpen(({ reason }) => failures.push(reason));
        useDefinitions(() => Promise.resolve([{ uri: JDT_TARGET, range: createRange(2, 13, 2, 24) }]));

        h.testApp.sendKey("F12");
        // Команда не ждётся: прокачиваем цепочку «реестр → провайдеры → открытие файла».
        await flushMicrotasks(10);

        expect(group().editorCount).toBe(1);
        expect(group().getActiveEditor()?.uri.scheme).toBe("file");
        // Каретка осталась на месте: чужие координаты в наш файл не уехали.
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

        // Ровно две записи: откуда прыгнули и куда. Промежуточного «открыли
        // ресурс в начале» быть не должно — за это отвечает jumpAsync, который
        // снимает точку назначения уже ПОСЛЕ ответа провайдера.
        expect(history.getEntries().map((e) => e.uri.scheme)).toEqual(["file", "jdt"]);
        expect(history.getEntries()[0]).toMatchObject({ line: 1, character: 4 });
        expect(history.getEntries()[1]).toMatchObject({ line: 2, character: 13 });

        history.goBack();
        expect(group().getActiveEditor()?.uri.toString()).toBe(appUri);
        expect(caret()).toMatchObject({ line: 1, character: 4 });

        // Возврат в исходник из jar — тоже синхронный: вкладка открыта, и
        // провайдера ради неё никто заново не тревожит.
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

        // Второй F12 уже ВНУТРИ исходника из jar, цель — он же: вкладка ищется
        // по ресурсу и переиспользуется, провайдера ради неё не тревожат.
        group().getActiveEditor()?.goToPosition(0, 0);
        await service().revealDefinition();

        expect(provide).toHaveBeenCalledTimes(1);
        expect(group().editorCount).toBe(2);
        expect(caret()).toMatchObject({ line: 2, character: 13 });
    });

    it("активного редактора нет — прыжок не падает и ничего не открывает", async () => {
        group().virtualDocumentSource = {
            canProvide: () => true,
            provide: () => Promise.resolve(JDT_SOURCE),
        };
        const source = () => Promise.resolve([{ uri: JDT_TARGET, range: createRange(2, 13, 2, 24) }]);
        useDefinitions(source);

        // Вкладок нет — спрашивать провайдеров определения не у чего.
        h.commands.execute("workbench.action.closeActiveEditor");
        expect(group().getActiveEditor()).toBeNull();
        await expect(service().revealDefinition()).resolves.toBeUndefined();

        expect(group().editorCount).toBe(0);
    });

    it("Ctrl+K F12 в недисковую цель открывает её в соседней группе", async () => {
        group().virtualDocumentSource = {
            canProvide: () => true,
            provide: () => Promise.resolve(JDT_SOURCE),
        };
        useDefinitions(() => Promise.resolve([{ uri: JDT_TARGET, range: createRange(2, 13, 2, 24) }]));

        await service().revealDefinition({ toSide: true });

        expect(group().groups.length).toBe(2);
        expect(group().getActiveEditor()?.uri.scheme).toBe("jdt");
        expect(caret()).toMatchObject({ line: 2, character: 13 });
    });
});
