import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { Uri } from "../../base/common/uri.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { createRange } from "../../editor/common/core/iRange.ts";
import type { ICoreReference, IReferenceRequest } from "../../editor/common/languages/iReferenceSource.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

import { WorkbenchComponentDIToken } from "./workbenchComponent.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

/**
 * Сквозной гейт Find All References «до кадра»: команда спрашивает
 * `EditorService.referenceSource` (тот самый шов, в который host кладёт
 * провайдеры расширений), добирает строки кода с диска и показывает вьюлет
 * REFERENCES в сайдбаре; Enter на ссылке открывает её файл на позиции, F4 идёт
 * к следующей.
 *
 * Юниты компонента и сервиса проверяют их собственную логику; здесь — проводка,
 * которой у них нет: контейнер вьюлета, команды в реестре, контекст-ключи и
 * DI-швы. Сборка живёт в теле теста, а не в `beforeEach`: покрытие (в том числе
 * мутационное) считается по телу, и проводка, поднятая в хуке, осталась бы
 * «ничьей».
 */

const FIND_REFERENCES = "references-view.findReferences";
const NEXT_REFERENCE = "references-view.next";
const SHOW_REFERENCES = "workbench.view.references";
const SHOW_EXPLORER = "workbench.view.explorer";

const MAIN_TS = 'import { greet } from "./defs";\n\nconst hello = greet("world");\n';
const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';

interface IHarness {
    readonly execute: (command: string) => void;
    readonly screen: () => string;
    readonly referenceList: () => ListViewElement;
    readonly contextKey: (key: "referencesViewletVisible" | "hasReferenceResult") => boolean | undefined;
    readonly activeUri: () => string | undefined;
    readonly caret: () => { line: number; character: number } | undefined;
    readonly requests: IReferenceRequest[];
    /** id элемента под фокусом — команда обязана увести его в список ссылок. */
    readonly focusedId: () => string | undefined;
    /** Корень вьюлета в живом дереве — контракт с инспектором и сценариями. */
    readonly viewRoot: () => unknown;
    /** Ждёт, пока асинхронный поиск (шов + чтение файлов) наполнит панель. */
    readonly awaitResults: () => Promise<void>;
}

describe("Workbench — Find All References end-to-end", () => {
    let ws: ITempWorkspace | undefined;

    afterEach(() => {
        ws?.dispose();
        ws = undefined;
    });

    function setup(): IHarness {
        ws = createTempWorkspace({
            prefix: "diode-references-",
            files: { "main.ts": MAIN_TS, "defs.ts": DEFS_TS },
        });
        const workspace = ws;

        const { container, bindApp } = createTestContainer();
        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const contextKeys = container.get(ContextKeyServiceDIToken);
        const workbenchContextKeys = container.get(WorkbenchContextKeysDIToken);
        const editors = container.get(EditorServiceDIToken);

        // Шов, в который в проде extensionHostModule кладёт провайдеры
        // расширений: объявление в defs.ts, импорт и вызов в main.ts.
        const requests: IReferenceRequest[] = [];
        editors.referenceSource = (request): Promise<readonly ICoreReference[]> => {
            requests.push(request);
            return Promise.resolve([
                { uri: Uri.file(workspace.path("defs.ts")).toString(), range: createRange(0, 16, 0, 21) },
                { uri: Uri.file(workspace.path("main.ts")).toString(), range: createRange(0, 9, 0, 14) },
                { uri: Uri.file(workspace.path("main.ts")).toString(), range: createRange(2, 14, 2, 19) },
            ]);
        };

        workbench.setWorkspaceFolder(workspace.dir);
        workbench.mount();
        const testApp = TestApp.create(workbench.view, new Size(120, 24));
        bindApp(testApp.app);

        // Каретка на вызове `greet` в main.ts.
        editors.openFile(workspace.path("main.ts"));
        editors.getActiveEditor()!.goToPosition(2, 15);

        return {
            execute: (command) => {
                commands.execute(command);
                workbenchContextKeys.update();
            },
            screen: () => {
                testApp.render();
                return testApp.backend.screenToString();
            },
            referenceList: () => {
                const list = workbench.view.querySelector("#referenceResults");
                expect(list, "список ссылок не найден в дереве").not.toBeNull();
                return list as ListViewElement;
            },
            contextKey: (key) => contextKeys.get(key),
            activeUri: () => editors.getActivePane()?.uri.toString(),
            caret: () => {
                const active = editors.getActiveEditor();
                return active === null ? undefined : active.viewState.selections[0].active;
            },
            requests,
            focusedId: () => testApp.focusedElement?.id,
            viewRoot: () => workbench.view.querySelector("#referencesView"),
            awaitResults: async () => {
                for (let i = 0; i < 100 && contextKeys.get("hasReferenceResult") !== true; i++) {
                    await settle(1);
                    workbenchContextKeys.update();
                }
            },
        };
    }

    it("команда спрашивает провайдеров по каретке и показывает ссылки в сайдбаре", async () => {
        const h = setup();
        expect(h.screen()).toContain("EXPLORER");

        h.execute(FIND_REFERENCES);
        await h.awaitResults();

        // Запрос ушёл с позицией каретки и контекстом LSP.
        expect(h.requests).toHaveLength(1);
        expect(h.requests[0]).toMatchObject({ line: 2, character: 15, includeDeclaration: true });

        const shown = h.screen();
        expect(shown).toContain("REFERENCES");
        expect(shown).toContain("3 results in 2 files");
        expect(shown).toContain("defs.ts");
        expect(shown).toContain("main.ts");
        // Строки кода добраны с диска — их в буфере main.ts нет.
        expect(shown).toContain("export function greet(");
        expect(shown).not.toContain("EXPLORER");
        expect(h.contextKey("referencesViewletVisible")).toBe(true);
        expect(h.contextKey("hasReferenceResult")).toBe(true);
        // Показ вьюлета уводит фокус в список — Enter сразу открывает ссылку.
        expect(h.focusedId()).toBe("referenceResults");
        expect(h.viewRoot()).not.toBeNull();
    });

    it("вьюлет доступен из меню View и до первого поиска — пустой панелью", () => {
        const h = setup();

        h.execute(SHOW_REFERENCES);

        const shown = h.screen();
        expect(shown).toContain("REFERENCES");
        expect(shown).not.toContain("EXPLORER");
        // Поиска ещё не было: ни счётчика, ни строк.
        expect(shown).not.toContain("results in");
        expect(h.contextKey("hasReferenceResult")).toBe(false);
    });

    it("Enter на ссылке открывает её файл на позиции", async () => {
        const h = setup();
        h.execute(FIND_REFERENCES);
        await h.awaitResults();

        const list = h.referenceList();
        list.setCursorTo("ref:defs.ts:0");
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
        await settle(0);

        expect(h.activeUri()).toBe(Uri.file(ws!.path("defs.ts")).toString());
        expect(h.caret()).toEqual({ line: 0, character: 16 });
    });

    it("F4 ведёт к следующей ссылке, не уводя фокус в панель", async () => {
        const h = setup();
        h.execute(FIND_REFERENCES);
        await h.awaitResults();

        // Курсор панели стоит на первой ссылке (defs.ts) — F4 ведёт ко второй.
        h.execute(NEXT_REFERENCE);
        await settle(0);

        expect(h.activeUri()).toBe(Uri.file(ws!.path("main.ts")).toString());
        expect(h.caret()).toEqual({ line: 0, character: 9 });
    });

    it("переключение на Explorer и обратно не теряет результат", async () => {
        const h = setup();
        h.execute(FIND_REFERENCES);
        await h.awaitResults();

        h.execute(SHOW_EXPLORER);
        expect(h.screen()).toContain("EXPLORER");
        expect(h.contextKey("referencesViewletVisible")).toBe(false);
        // Результат жив — ключ данных от видимости вьюлета не зависит.
        expect(h.contextKey("hasReferenceResult")).toBe(true);

        h.execute(SHOW_REFERENCES);
        const shown = h.screen();
        expect(shown).toContain("3 results in 2 files");
        expect(shown).toContain("defs.ts");
    });
});
