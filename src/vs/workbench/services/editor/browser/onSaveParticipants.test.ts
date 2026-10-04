import { describe, expect, it } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { ISelection } from "../../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ICodeActionRequest, ICoreCodeAction } from "../../../../editor/common/languages/iCodeActionSource.ts";
import type { IFormattingRequest } from "../../../../editor/common/languages/iFormattingSource.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { ISaveSnapshot } from "../../textfile/common/iSaveParticipant.ts";

import {
    createCodeActionsOnSaveParticipant,
    createFormatOnSaveParticipant,
    enabledCodeActionKindsOnSave,
    type IOnSaveParticipantHost,
} from "./onSaveParticipants.ts";

// Юнит-грань участников onSave: парсинг настройки и краевые случаи без
// панели/источника. Поведение с настоящими панелями — editorService.onSave.test.ts.

function config(values: Record<string, unknown>): IConfigurationService {
    return createTestConfigurationService(values);
}

const SNAPSHOT: ISaveSnapshot = {
    uri: "file:///a.py",
    languageId: "python",
    versionId: 1,
    isDirty: true,
    text: "one\ntwo",
    eol: EndOfLine.LF,
    encoding: "utf8",
};

/** Провайдер code actions теста: что вернуть на запрос и чем ответить на apply. */
interface IFakeCodeActions {
    provide(request: ICodeActionRequest): Promise<readonly ICoreCodeAction[] | null>;
    apply(id: string): Promise<boolean>;
}

/**
 * Хост участников с реестрами, в которых — провайдеры теста под `*`
 * (`codeActions` — code-action-провайдер, `format` — документный форматтер).
 */
function host(overrides: {
    configuration: IConfigurationService;
    codeActions?: IFakeCodeActions;
    format?: (request: IFormattingRequest) => Promise<readonly ITextEdit[] | null>;
    paneForUri?: IOnSaveParticipantHost["paneForUri"];
}): IOnSaveParticipantHost {
    const languageFeatures = new LanguageFeaturesService();
    const { codeActions, format } = overrides;
    if (codeActions !== undefined) {
        languageFeatures.codeActionProvider.register("*", {
            providedCodeActionKinds: [],
            provideCodeActions: async (request) => (await codeActions.provide(request)) ?? [],
            applyCodeAction: (id) => codeActions.apply(id),
        });
    }
    if (format !== undefined) {
        languageFeatures.documentFormattingEditProvider.register("*", {
            provideDocumentFormattingEdits: async (request) => (await format(request)) ?? [],
        });
    }
    return {
        configuration: overrides.configuration,
        languageFeatures,
        paneForUri: overrides.paneForUri ?? (() => null),
    };
}

describe("enabledCodeActionKindsOnSave", () => {
    it("объект: true/explicit/always включают, false/never/прочее — нет", () => {
        const kinds = enabledCodeActionKindsOnSave(
            config({
                "editor.codeActionsOnSave": {
                    a: true,
                    b: "explicit",
                    c: "always",
                    d: false,
                    e: "never",
                    f: 1,
                },
            }),
        );
        expect(kinds).toEqual(["a", "b", "c"]);
    });

    it("массив: строки включены, не-строки отфильтрованы", () => {
        expect(
            enabledCodeActionKindsOnSave(config({ "editor.codeActionsOnSave": ["source.fixAll", 5, null] })),
        ).toEqual(["source.fixAll"]);
    });

    it("массивная форма проходит схему настроек приложения, а не подменяется дефолтом", () => {
        const configuration = createTestConfigurationService({
            "editor.codeActionsOnSave": ["source.organizeImports"],
        });
        expect(enabledCodeActionKindsOnSave(configuration)).toEqual(["source.organizeImports"]);
    });

    it("секция языка документа: объект сливается с плоским (как у VS Code), другой язык — только плоские", () => {
        const configuration = config({
            "editor.codeActionsOnSave": { "source.fixAll": true },
            "[python]": { "editor.codeActionsOnSave": { "source.organizeImports": true } },
        });
        expect(enabledCodeActionKindsOnSave(configuration, "python")).toEqual([
            "source.fixAll",
            "source.organizeImports",
        ]);
        expect(enabledCodeActionKindsOnSave(configuration, "go")).toEqual(["source.fixAll"]);
    });

    it("не задано / null / не-объект → пусто", () => {
        expect(enabledCodeActionKindsOnSave(config({}))).toEqual([]);
        // Сервис без дефолтов (null-заглушка) — ключа нет вовсе.
        expect(enabledCodeActionKindsOnSave(NULL_CONFIGURATION_SERVICE)).toEqual([]);
        expect(enabledCodeActionKindsOnSave(config({ "editor.codeActionsOnSave": null }))).toEqual([]);
        expect(enabledCodeActionKindsOnSave(config({ "editor.codeActionsOnSave": "source.fixAll" }))).toEqual([]);
    });
});

describe("createCodeActionsOnSaveParticipant", () => {
    it("без источника — пустой результат, настройка даже не читается", async () => {
        let read = false;
        const participant = createCodeActionsOnSaveParticipant(
            host({
                configuration: {
                    ...NULL_CONFIGURATION_SERVICE,
                    get: () => {
                        read = true;
                        return undefined;
                    },
                },
            }),
        );
        expect(await participant(SNAPSHOT)).toEqual([]);
        expect(read).toBe(false);
    });

    it("provide вернул null (нет матчащего провайдера) — apply не дёргается", async () => {
        let applied = 0;
        const source: IFakeCodeActions = {
            provide: () => Promise.resolve(null),
            apply: () => {
                applied++;
                return Promise.resolve(true);
            },
        };
        const participant = createCodeActionsOnSaveParticipant(
            host({
                configuration: config({ "editor.codeActionsOnSave": { "source.fixAll": true } }),
                codeActions: source,
            }),
        );

        expect(await participant(SNAPSHOT)).toEqual([]);
        expect(applied).toBe(0);
    });

    it("без панели диапазон и версия берутся из снапшота", async () => {
        const provided: { versionId: number; endLine: number; endCharacter: number }[] = [];
        const source: IFakeCodeActions = {
            provide: (req) => {
                provided.push({
                    versionId: req.versionId,
                    endLine: req.range.end.line,
                    endCharacter: req.range.end.character,
                });
                return Promise.resolve([]);
            },
            apply: () => Promise.resolve(true),
        };
        const participant = createCodeActionsOnSaveParticipant(
            host({
                configuration: config({ "editor.codeActionsOnSave": { "source.fixAll": true } }),
                codeActions: source,
            }),
        );

        expect(await participant({ ...SNAPSHOT, versionId: 7 })).toEqual([]);
        // «one\ntwo»: конец диапазона — строка 1, длина «two».
        expect(provided).toEqual([{ versionId: 7, endLine: 1, endCharacter: 3 }]);
    });

    it("с панелью диапазон и версия берутся из панели, а не из снапшота", async () => {
        const provided: { versionId: number; endLine: number; endCharacter: number }[] = [];
        const source: IFakeCodeActions = {
            provide: (req) => {
                provided.push({
                    versionId: req.versionId,
                    endLine: req.range.end.line,
                    endCharacter: req.range.end.character,
                });
                return Promise.resolve([]);
            },
            apply: () => Promise.resolve(true),
        };
        const { pane } = fakePane(
            () => "a\nbc\ndef!",
            () => 42,
        );
        const participant = createCodeActionsOnSaveParticipant(
            host({
                configuration: config({ "editor.codeActionsOnSave": { "source.fixAll": true } }),
                codeActions: source,
                paneForUri: () => pane,
            }),
        );

        expect(await participant({ ...SNAPSHOT, versionId: 7 })).toEqual([]);
        expect(provided).toEqual([{ versionId: 42, endLine: 2, endCharacter: 4 }]);
    });
});

/** Фейковая панель участников: текст, версия модели, viewState и журнал правок. */
function fakePane(
    getText: () => string,
    versionId: () => number = () => 1,
): {
    pane: TextEditorPane;
    applied: { edits: number; label: string }[];
} {
    const applied: { edits: number; label: string }[] = [];
    const pane = {
        getText,
        model: {
            get document() {
                return { versionId: versionId() };
            },
        },
        viewState: { tabSize: 4, insertSpaces: true, selections: [] as ISelection[] },
        applyExternalEdits: (edits: readonly unknown[], label: string) => {
            applied.push({ edits: edits.length, label });
        },
    } as unknown as TextEditorPane;
    return { pane, applied };
}

describe("createFormatOnSaveParticipant", () => {
    it("настройка выключена — источник не дёргается даже при живой панели", async () => {
        let called = false;
        const { pane } = fakePane(() => "x");
        const participant = createFormatOnSaveParticipant(
            host({
                configuration: config({}),
                format: () => {
                    called = true;
                    return Promise.resolve([]);
                },
                paneForUri: () => pane,
            }),
        );
        expect(await participant(SNAPSHOT)).toEqual([]);
        expect(called).toBe(false);
    });

    it("включена только в секции языка документа — участник работает для него, не для других", async () => {
        let calls = 0;
        const { pane } = fakePane(() => "x");
        const participant = createFormatOnSaveParticipant(
            host({
                configuration: config({ "[python]": { "editor.formatOnSave": true } }),
                format: () => {
                    calls++;
                    return Promise.resolve([]);
                },
                paneForUri: () => pane,
            }),
        );

        await participant(SNAPSHOT); // python
        await participant({ ...SNAPSHOT, uri: "file:///a.ts", languageId: "typescript" });

        expect(calls).toBe(1);
    });

    it("включена, панель есть, но источника нет (host отвалился) — no-op", async () => {
        const { pane, applied } = fakePane(() => "x");
        const participant = createFormatOnSaveParticipant(
            host({
                configuration: config({ "editor.formatOnSave": true }),
                paneForUri: () => pane,
            }),
        );
        expect(await participant(SNAPSHOT)).toEqual([]);
        expect(applied).toEqual([]);
    });

    it("успешный формат: правки применяются с меткой Format on Save, результат пуст", async () => {
        const { pane, applied } = fakePane(() => "x");
        const participant = createFormatOnSaveParticipant(
            host({
                configuration: config({ "editor.formatOnSave": true }),
                format: () =>
                    Promise.resolve([
                        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, text: "y" },
                    ]),
                paneForUri: () => pane,
            }),
        );

        expect(await participant(SNAPSHOT)).toEqual([]);
        expect(applied).toEqual([{ edits: 1, label: "Format on Save" }]);
    });

    it("устаревший ответ (версия сменилась за время RPC) — правки не применяются", async () => {
        let reads = 0;
        const { pane, applied } = fakePane(
            () => "x",
            () => (reads++ === 0 ? 1 : 2),
        );
        const participant = createFormatOnSaveParticipant(
            host({
                configuration: config({ "editor.formatOnSave": true }),
                format: () =>
                    Promise.resolve([
                        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, text: "y" },
                    ]),
                paneForUri: () => pane,
            }),
        );

        expect(await participant(SNAPSHOT)).toEqual([]);
        expect(applied).toEqual([]);
    });

    it("включена, но панели нет (файл сохраняется без вью) — no-op", async () => {
        let called = false;
        const participant = createFormatOnSaveParticipant(
            host({
                configuration: config({ "editor.formatOnSave": true }),
                format: () => {
                    called = true;
                    return Promise.resolve([]);
                },
            }),
        );
        expect(await participant(SNAPSHOT)).toEqual([]);
        expect(called).toBe(false);
    });

    it("пустой ответ форматтера (менять нечего) — no-op без правок", async () => {
        let editsApplied = 0;
        const pane = {
            getText: () => "x",
            model: { document: { versionId: 1 } },
            viewState: { tabSize: 4, insertSpaces: true, selections: [] as ISelection[] },
            applyExternalEdits: () => {
                editsApplied++;
            },
        } as unknown as TextEditorPane;
        const participant = createFormatOnSaveParticipant(
            host({
                configuration: config({ "editor.formatOnSave": true }),
                format: () => Promise.resolve([]),
                paneForUri: () => pane,
            }),
        );

        expect(await participant(SNAPSHOT)).toEqual([]);
        expect(editsApplied).toBe(0);
    });

    it("настройки отступов запроса берутся из viewState панели", async () => {
        const requests: { tabSize: number; insertSpaces: boolean }[] = [];
        const pane = {
            getText: () => "x",
            model: { document: { versionId: 1 } },
            viewState: { tabSize: 3, insertSpaces: false, selections: [] as ISelection[] },
            applyExternalEdits: () => undefined,
        } as unknown as TextEditorPane;
        const participant = createFormatOnSaveParticipant(
            host({
                configuration: config({ "editor.formatOnSave": true }),
                format: (req) => {
                    requests.push({ tabSize: req.tabSize, insertSpaces: req.insertSpaces });
                    return Promise.resolve(null);
                },
                paneForUri: () => pane,
            }),
        );

        expect(await participant(SNAPSHOT)).toEqual([]);
        expect(requests).toEqual([{ tabSize: 3, insertSpaces: false }]);
    });

    it("запрос несёт версию панели; range-форматтеру — диапазон всего текста панели", async () => {
        const { pane, applied } = fakePane(
            () => "a\nbc\ndef!",
            () => 5,
        );
        const formatHost = host({ configuration: config({ "editor.formatOnSave": true }), paneForUri: () => pane });
        const requests: (IFormattingRequest & { readonly range?: unknown })[] = [];
        formatHost.languageFeatures.documentRangeFormattingEditProvider.register("*", {
            provideDocumentRangeFormattingEdits: (req) => {
                requests.push(req);
                return Promise.resolve([
                    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, text: "y" },
                ]);
            },
        });

        expect(await createFormatOnSaveParticipant(formatHost)(SNAPSHOT)).toEqual([]);
        expect(requests).toHaveLength(1);
        expect(requests[0].versionId).toBe(5);
        expect(requests[0].range).toEqual({ start: { line: 0, character: 0 }, end: { line: 2, character: 4 } });
        expect(applied).toEqual([{ edits: 1, label: "Format on Save" }]);
    });
});
