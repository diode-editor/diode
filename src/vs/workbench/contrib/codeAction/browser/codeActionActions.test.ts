import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ICodeActionRequest, ICoreCodeAction } from "../../../../editor/common/languages/iCodeActionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    type QuickInputService,
    QuickInputServiceDIToken,
} from "../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

import {
    fixAllAction,
    organizeImportsAction,
    quickFixAction,
    refactorAction,
    sourceActionAction,
} from "./codeActionActions.ts";

// Source-команды code actions: полный диапазон + only в запросе, выбор
// предпочтительного действия, честные notices на «нечего применять» и отказ.

interface ISetup {
    accessor: Container;
    requests: ICodeActionRequest[];
    appliedIds: string[];
    notices: string[];
    pickCalls: { title?: string; placeholder?: string; items: readonly QuickPickItem[] }[];
}

/** Провайдер code actions теста: что вернуть на запрос и чем ответить на apply. */
interface FakeCodeActions {
    provide(request: ICodeActionRequest): Promise<readonly ICoreCodeAction[]>;
    apply(id: string): Promise<boolean>;
}

function makeSetup(
    source: FakeCodeActions | undefined,
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
        // Запрос несёт версию модели, а не текст (его субпроцесс берёт из зеркала).
        model: { document: { versionId: 7 } },
        viewState: {
            selections: [options.selection ?? { anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }],
        },
    };
    const languageFeatures = new LanguageFeaturesService();
    if (source !== undefined) {
        languageFeatures.codeActionProvider.register("*", {
            providedCodeActionKinds: [],
            provideCodeActions: async (request) => {
                requests.push(request);
                return source.provide(request);
            },
            applyCodeAction: async (id) => {
                appliedIds.push(id);
                return source.apply(id);
            },
        });
    }
    const group = {
        getActiveEditor: () => editor,
    } as unknown as IEditorService;
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
    accessor.bind(LanguageFeaturesServiceDIToken, () => languageFeatures);
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
                versionId: 7,
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

    it("нет провайдера для документа или нет действий ([]) — notice, apply не зовётся", async () => {
        const noSource = makeSetup(undefined);
        await organizeImportsAction.run(noSource.accessor);
        expect(noSource.notices).toEqual(["codeAction.notice: No organize imports action for 'python'"]);

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
        const setup = makeSetup({ provide, apply: () => Promise.resolve(true) } as unknown as FakeCodeActions);
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
            {
                pickLabel: "Extract method",
                selection: { anchor: { line: 1, character: 3 }, active: { line: 1, character: 3 } },
            },
        );
        await quickFixAction.run(setup.accessor);

        // Пустое выделение → строка каретки (строка 1 — "import a", 8 символов), only отсутствует.
        expect(setup.requests).toStrictEqual([
            {
                uri: Uri.file("/proj/a.py").toString(),
                languageId: "python",
                versionId: 7,
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

    it("quickFix: сортировка меню — quickfix выше refactor/source, preferred первым в группе, apply по своему id", async () => {
        // Порядок провайдеров (многословный tsserver первым) не должен
        // выталкивать фиксы линтера за край попапа — поймано на живом дуэте
        // tsserver+eslint: 16 рефакторингов хоронили 9 quickfix'ов.
        // Виды нарочно перемешаны и покрывают обе формы каждого ранга (точный
        // kind и подвид), незнакомый вид и голую команду — хвост списка.
        const setup = makeSetup(
            {
                provide: () =>
                    Promise.resolve([
                        // preferred первым, обычный сразу за ним: insertion-sort
                        // V8 зовёт compare(новый, существующий), и вставка
                        // второго элемента гарантированно идёт веткой «a обычный,
                        // b preferred» (`: 1` — на CI она осталась непокрытой,
                        // main покраснел по храповику ветвей).
                        { id: "1.0", title: "Fix preferred", kind: "quickfix", isPreferred: true },
                        { id: "1.1", title: "Fix plain", kind: "quickfix" },
                        { id: "1.2", title: "Src organize", kind: "source.organizeImports" },
                        { id: "1.3", title: "Refactor extract", kind: "refactor.extract" },
                        { id: "1.4", title: "Weird kind", kind: "weird.kind" },
                        { id: "1.5", title: "Fix sub", kind: "quickfix.special" },
                        { id: "1.6", title: "Bare command" },
                        { id: "1.7", title: "Refactor preferred", kind: "refactor", isPreferred: true },
                        { id: "1.8", title: "Src exact", kind: "source" },
                    ]),
                apply: () => Promise.resolve(true),
            },
            { pickLabel: "Fix preferred" },
        );
        await quickFixAction.run(setup.accessor);

        expect(setup.pickCalls[0]?.items.map((i) => i.label)).toEqual([
            "Fix preferred",
            "Fix plain",
            "Fix sub",
            "Refactor preferred",
            "Refactor extract",
            "Src organize",
            "Src exact",
            "Weird kind",
            "Bare command",
        ]);
        // Выбор мапится в id ИСХОДНОГО действия, а не в позицию до сортировки.
        expect(setup.appliedIds).toEqual(["1.0"]);
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
    });

    it("quickFix: без активного редактора — тихий выход", async () => {
        const provide = vi.fn();
        const setup = makeSetup({ provide, apply: () => Promise.resolve(true) } as unknown as FakeCodeActions);
        (setup.accessor.get(EditorServiceDIToken) as { getActiveEditor: () => unknown }).getActiveEditor = () => null;
        await quickFixAction.run(setup.accessor);
        expect(provide).not.toHaveBeenCalled();
    });

    it("Refactor…: запрос с only=refactor, свой заголовок меню и свой текст «пусто»", async () => {
        const setup = makeSetup(
            {
                provide: () => Promise.resolve([{ id: "2.0", title: "Extract method", kind: "refactor.extract" }]),
                apply: () => Promise.resolve(true),
            },
            {
                pickLabel: "Extract method",
                selection: { anchor: { line: 1, character: 3 }, active: { line: 1, character: 3 } },
            },
        );

        await refactorAction.run(setup.accessor);

        expect(setup.requests).toStrictEqual([
            {
                uri: Uri.file("/proj/a.py").toString(),
                languageId: "python",
                versionId: 7,
                range: createRange(1, 0, 1, 8),
                only: "refactor",
            },
        ]);
        expect(setup.pickCalls[0].title).toBe("Refactor");
        expect(setup.appliedIds).toEqual(["2.0"]);

        const empty = makeSetup({ provide: () => Promise.resolve([]), apply: () => Promise.resolve(true) });
        await refactorAction.run(empty.accessor);
        expect(empty.notices).toEqual(["codeAction.notice: No refactorings available"]);
    });

    it("Source Action…: запрос с only=source, свой заголовок меню и свой текст «пусто»", async () => {
        const setup = makeSetup(
            {
                provide: () =>
                    Promise.resolve([{ id: "3.0", title: "Organize Imports", kind: "source.organizeImports" }]),
                apply: () => Promise.resolve(true),
            },
            { pickLabel: "Organize Imports" },
        );

        await sourceActionAction.run(setup.accessor);

        expect(setup.requests[0]).toMatchObject({ only: "source" });
        expect(setup.pickCalls[0].title).toBe("Source Action");
        expect(setup.appliedIds).toEqual(["3.0"]);

        const empty = makeSetup({ provide: () => Promise.resolve([]), apply: () => Promise.resolve(true) });
        await sourceActionAction.run(empty.accessor);
        expect(empty.notices).toEqual(["codeAction.notice: No source actions available"]);
    });

    it("метаданные запиннены: id/title/бинды/when — пользовательский контракт", () => {
        expect(organizeImportsAction.id).toBe("editor.action.organizeImports");
        expect(organizeImportsAction.title).toBe("Organize Imports");
        // Первичный — досягаемый на любом терминале аккорд; канонический Shift+Alt+O
        // под tier-гейтом (shift под Alt в legacy-поток не попадает).
        expect(organizeImportsAction.keybinding).toEqual(parseChord("ctrl+k alt+o"));
        expect(organizeImportsAction.keybindings).toEqual([
            { keys: parseKeybinding("shift+alt+o"), when: "tier != 'legacy'" },
        ]);
        expect(organizeImportsAction.when).toBe("textInputFocus && !editorReadonly");

        expect(refactorAction.id).toBe("editor.action.refactor");
        expect(refactorAction.title).toBe("Refactor...");
        expect(refactorAction.keybinding).toEqual(parseChord("ctrl+k alt+r"));
        expect(refactorAction.keybindings).toEqual([
            { keys: parseKeybinding("mod+shift+r"), when: "tier != 'legacy'" },
        ]);
        expect(refactorAction.when).toBe("textInputFocus && !editorReadonly");

        expect(sourceActionAction.id).toBe("editor.action.sourceAction");
        expect(sourceActionAction.title).toBe("Source Action...");
        expect(sourceActionAction.keybinding).toBeUndefined();
        expect(sourceActionAction.when).toBe("textInputFocus && !editorReadonly");

        expect(fixAllAction.id).toBe("editor.action.fixAll");
        expect(fixAllAction.title).toBe("Fix All");
        expect(fixAllAction.keybinding).toBeUndefined();
        expect(fixAllAction.when).toBe("textInputFocus && !editorReadonly");

        expect(quickFixAction.id).toBe("editor.action.quickFix");
        expect(quickFixAction.title).toBe("Quick Fix");
        expect(quickFixAction.keybinding).toEqual(parseKeybinding("mod+."));
        // Второй бинд — единственный досягаемый на legacy-tier'е.
        expect(quickFixAction.keybindings).toEqual([parseChord("ctrl+k ctrl+q")]);
        expect(quickFixAction.when).toBe("textInputFocus && !editorReadonly");
    });
});
