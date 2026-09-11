import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import type { CodeActionSource, ICodeActionRequest } from "../../../editor/common/languages/iCodeActionSource.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken, type EditorService } from "../../services/editor/browser/editorService.ts";
import { StatusBarServiceDIToken, type StatusBarService } from "../../services/statusbar/common/statusBarService.ts";

import { fixAllAction, organizeImportsAction } from "./codeActionActions.ts";

// Source-команды code actions: полный диапазон + only в запросе, выбор
// предпочтительного действия, честные notices на «нечего применять» и отказ.

interface ISetup {
    accessor: Container;
    requests: ICodeActionRequest[];
    appliedIds: string[];
    notices: string[];
}

function makeSetup(source: CodeActionSource | undefined): ISetup {
    const requests: ICodeActionRequest[] = [];
    const appliedIds: string[] = [];
    const editor = {
        uri: Uri.file("/proj/a.py"),
        languageId: "python",
        getText: () => "import b\nimport a",
    };
    const wrapped: CodeActionSource | undefined =
        source === undefined
            ? undefined
            : {
                  provide: async (request) => {
                      requests.push(request);
                      return source.provide(request);
                  },
                  apply: async (id) => {
                      appliedIds.push(id);
                      return source.apply(id);
                  },
              };
    const group = {
        getActiveEditor: () => editor,
        codeActionSource: wrapped,
    } as unknown as EditorService;
    const notices: string[] = [];
    const statusBar = {
        addEntry: (entry: { id: string; text: string }) => {
            notices.push(`${entry.id}: ${entry.text}`);
            return { dispose: () => undefined };
        },
    } as unknown as StatusBarService;
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => group);
    accessor.bind(StatusBarServiceDIToken, () => statusBar);
    return { accessor, requests, appliedIds, notices };
}

const ACTION = { id: "1.0", title: "Organize" };

describe("editor.action.organizeImports / fixAll", () => {
    it("запрос: полный диапазон документа + свой only; применяется первое действие", async () => {
        const setup = makeSetup({
            provide: () => Promise.resolve([ACTION, { id: "1.1", title: "Second" }]),
            apply: () => Promise.resolve(true),
        });
        await organizeImportsAction.run(setup.accessor);
        expect(setup.requests).toStrictEqual([
            {
                uri: Uri.file("/proj/a.py").toString(),
                languageId: "python",
                text: "import b\nimport a",
                range: createRange(0, 0, 1, 8),
                only: "source.organizeImports",
            },
        ]);
        expect(setup.appliedIds).toEqual(["1.0"]);
        expect(setup.notices).toEqual([]);

        const fixAll = makeSetup({ provide: () => Promise.resolve([ACTION]), apply: () => Promise.resolve(true) });
        await fixAllAction.run(fixAll.accessor);
        expect(fixAll.requests[0].only).toBe("source.fixAll");
    });

    it("предпочтительное действие выигрывает у первого", async () => {
        const setup = makeSetup({
            provide: () =>
                Promise.resolve([
                    { id: "1.0", title: "Plain" },
                    { id: "1.1", title: "Preferred", isPreferred: true },
                ]),
            apply: () => Promise.resolve(true),
        });
        await organizeImportsAction.run(setup.accessor);
        expect(setup.appliedIds).toEqual(["1.1"]);
    });

    it("нет источника, нет провайдера (null) или нет действий ([]) — notice, apply не зовётся", async () => {
        const noSource = makeSetup(undefined);
        await organizeImportsAction.run(noSource.accessor);
        expect(noSource.notices).toEqual(["codeAction.notice: No organize imports action for 'python'"]);

        const nullAnswer = makeSetup({ provide: () => Promise.resolve(null), apply: () => Promise.resolve(true) });
        await organizeImportsAction.run(nullAnswer.accessor);
        expect(nullAnswer.notices).toEqual(["codeAction.notice: No organize imports action for 'python'"]);
        expect(nullAnswer.appliedIds).toEqual([]);

        const emptyAnswer = makeSetup({ provide: () => Promise.resolve([]), apply: () => Promise.resolve(true) });
        await fixAllAction.run(emptyAnswer.accessor);
        expect(emptyAnswer.notices).toEqual(["codeAction.notice: No fix all action for 'python'"]);
    });

    it("отказ apply — notice с названием действия; успех — тишина", async () => {
        const failing = makeSetup({ provide: () => Promise.resolve([ACTION]), apply: () => Promise.resolve(false) });
        await organizeImportsAction.run(failing.accessor);
        expect(failing.notices).toEqual(["codeAction.notice: Code action failed: Organize"]);
    });

    it("без активного редактора — тихий выход", async () => {
        const provide = vi.fn();
        const setup = makeSetup({ provide, apply: () => Promise.resolve(true) } as unknown as CodeActionSource);
        (setup.accessor.get(EditorServiceDIToken) as { getActiveEditor: () => unknown }).getActiveEditor = () => null;
        await organizeImportsAction.run(setup.accessor);
        expect(provide).not.toHaveBeenCalled();
        expect(setup.notices).toEqual([]);
    });

    it("метаданные запиннены: id/title/бинды/when — пользовательский контракт", () => {
        expect(organizeImportsAction.id).toBe("editor.action.organizeImports");
        expect(organizeImportsAction.title).toBe("Organize Imports");
        expect(organizeImportsAction.keybinding).toEqual(parseKeybinding("shift+alt+o"));
        expect(organizeImportsAction.when).toBe("textInputFocus && !editorReadonly");

        expect(fixAllAction.id).toBe("editor.action.fixAll");
        expect(fixAllAction.title).toBe("Fix All");
        expect(fixAllAction.keybinding).toBeUndefined();
        expect(fixAllAction.when).toBe("textInputFocus && !editorReadonly");
    });
});
