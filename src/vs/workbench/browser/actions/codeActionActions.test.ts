import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import type { CodeActionSource, ICodeActionRequest } from "../../../editor/common/languages/iCodeActionSource.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken, type EditorService } from "../../services/editor/browser/editorService.ts";
import { StatusBarServiceDIToken, type StatusBarService } from "../../services/statusbar/common/statusBarService.ts";

import type { QuickPickItem } from "../../common/quickPickItem.ts";
import { QuickInputServiceDIToken, type QuickInputService } from "../parts/quickinput/quickInputService.ts";

import { fixAllAction, organizeImportsAction, quickFixAction } from "./codeActionActions.ts";

// Source-команды code actions: полный диапазон + only в запросе, выбор
// предпочтительного действия, честные notices на «нечего применять» и отказ.

interface ISetup {
    accessor: Container;
    requests: ICodeActionRequest[];
    appliedIds: string[];
    notices: string[];
    pickCalls: { title?: string; placeholder?: string; items: readonly QuickPickItem[] }[];
}

function makeSetup(
    source: CodeActionSource | undefined,
    options: {
        /** Выбор в quick pick по label; отсутствие поля — отмена (undefined). */
        pickLabel?: string;
        selection?: { anchor: { line: number; character: number }; active: { line: number; character: number } };
    } = {},
): ISetup {
    const requests: ICodeActionRequest[] = [];
    const appliedIds: string[] = [];
    const pickCalls: { title?: string; placeholder?: string; items: readonly QuickPickItem[] }[] = [];
    const editor = {
        uri: Uri.file("/proj/a.py"),
        languageId: "python",
        getText: () => "import b\nimport a",
        viewState: {
            selections: [
                options.selection ?? { anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } },
            ],
        },
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
    const quickInput = {
        quickPick: (opts: { title?: string; placeholder?: string; items: readonly QuickPickItem[] }) => {
            pickCalls.push({ title: opts.title, placeholder: opts.placeholder, items: opts.items });
            return Promise.resolve(
                options.pickLabel === undefined
                    ? undefined
                    : opts.items.find((item) => item.label === options.pickLabel),
            );
        },
    } as unknown as QuickInputService;
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => group);
    accessor.bind(StatusBarServiceDIToken, () => statusBar);
    accessor.bind(QuickInputServiceDIToken, () => quickInput);
    return { accessor, requests, appliedIds, notices, pickCalls };
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

    it("quickFix: запрос по строке каретки БЕЗ only, меню с kind/badge, выбранное применяется", async () => {
        const setup = makeSetup(
            {
                provide: () =>
                    Promise.resolve([
                        { id: "1.0", title: "Remove unused", kind: "quickfix", isPreferred: true },
                        { id: "1.1", title: "Extract method", kind: "refactor.extract" },
                        // Голая команда — без kind и badge: лишние ключи в
                        // пункте меню не выдумываются (strict ниже).
                        { id: "1.2", title: "Bare command" },
                    ]),
                apply: () => Promise.resolve(true),
            },
            { pickLabel: "Extract method", selection: { anchor: { line: 1, character: 3 }, active: { line: 1, character: 3 } } },
        );
        await quickFixAction.run(setup.accessor);

        // Пустое выделение → строка каретки (строка 1 — "import a", 8 символов), only отсутствует.
        expect(setup.requests).toStrictEqual([
            {
                uri: Uri.file("/proj/a.py").toString(),
                languageId: "python",
                text: "import b\nimport a",
                range: createRange(1, 0, 1, 8),
            },
        ]);
        expect(setup.pickCalls).toStrictEqual([
            {
                title: "Code Actions",
                placeholder: "Select Code Action",
                items: [
                    { label: "Remove unused", description: "quickfix", badge: "preferred" },
                    { label: "Extract method", description: "refactor.extract" },
                    { label: "Bare command" },
                ],
            },
        ]);
        expect(setup.appliedIds).toEqual(["1.1"]);
        expect(setup.notices).toEqual([]);
    });

    it("quickFix: отмена меню — тишина; отказ apply — notice; пусто/нет источника — notice без меню", async () => {
        const cancelled = makeSetup({
            provide: () => Promise.resolve([{ id: "1.0", title: "Fix" }]),
            apply: () => Promise.resolve(true),
        });
        await quickFixAction.run(cancelled.accessor);
        expect(cancelled.appliedIds).toEqual([]);
        expect(cancelled.notices).toEqual([]);

        const failing = makeSetup(
            { provide: () => Promise.resolve([{ id: "1.0", title: "Fix" }]), apply: () => Promise.resolve(false) },
            { pickLabel: "Fix" },
        );
        await quickFixAction.run(failing.accessor);
        expect(failing.notices).toEqual(["codeAction.notice: Code action failed: Fix"]);

        const empty = makeSetup({ provide: () => Promise.resolve([]), apply: () => Promise.resolve(true) });
        await quickFixAction.run(empty.accessor);
        expect(empty.notices).toEqual(["codeAction.notice: No code actions available"]);
        expect(empty.pickCalls).toEqual([]);

        const noSource = makeSetup(undefined);
        await quickFixAction.run(noSource.accessor);
        expect(noSource.notices).toEqual(["codeAction.notice: No code actions available"]);

        const nullAnswer = makeSetup({ provide: () => Promise.resolve(null), apply: () => Promise.resolve(true) });
        await quickFixAction.run(nullAnswer.accessor);
        expect(nullAnswer.notices).toEqual(["codeAction.notice: No code actions available"]);
    });

    it("quickFix: без активного редактора — тихий выход", async () => {
        const provide = vi.fn();
        const setup = makeSetup({ provide, apply: () => Promise.resolve(true) } as unknown as CodeActionSource);
        (setup.accessor.get(EditorServiceDIToken) as { getActiveEditor: () => unknown }).getActiveEditor = () => null;
        await quickFixAction.run(setup.accessor);
        expect(provide).not.toHaveBeenCalled();
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

        expect(quickFixAction.id).toBe("editor.action.quickFix");
        expect(quickFixAction.title).toBe("Quick Fix");
        expect(quickFixAction.keybinding).toEqual(parseKeybinding("ctrl+."));
        // Второй бинд — единственный досягаемый на legacy-tier'е.
        expect(quickFixAction.keybindings).toEqual([parseChord("ctrl+k ctrl+q")]);
        expect(quickFixAction.when).toBe("textInputFocus && !editorReadonly");
    });
});
