import { describe, expect, it } from "vitest";

import type { ISelection } from "../../../../editor/common/core/iSelection.ts";
import type { CodeActionSource } from "../../../../editor/common/languages/iCodeActionSource.ts";
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
    return {
        ...NULL_CONFIGURATION_SERVICE,
        get<T>(key: string, defaultValue?: T): T | undefined {
            return key in values ? (values[key] as T) : defaultValue;
        },
    };
}

const SNAPSHOT: ISaveSnapshot = {
    uri: "file:///a.py",
    languageId: "python",
    versionId: 1,
    isDirty: true,
    text: "one\ntwo",
    eol: 0,
    encoding: "utf8",
};

function host(overrides: Partial<IOnSaveParticipantHost> & { configuration: IConfigurationService }): IOnSaveParticipantHost {
    return {
        codeActionSource: () => undefined,
        formattingSource: () => undefined,
        paneForUri: () => null,
        ...overrides,
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

    it("не задано / null / не-объект → пусто", () => {
        expect(enabledCodeActionKindsOnSave(config({}))).toEqual([]);
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

    it("без панели диапазон и текст берутся из снапшота", async () => {
        const provided: { text: string; endLine: number; endCharacter: number }[] = [];
        const source: CodeActionSource = {
            provide: (req) => {
                provided.push({ text: req.text, endLine: req.range.end.line, endCharacter: req.range.end.character });
                return Promise.resolve([]);
            },
            apply: () => Promise.resolve(true),
        };
        const participant = createCodeActionsOnSaveParticipant(
            host({
                configuration: config({ "editor.codeActionsOnSave": { "source.fixAll": true } }),
                codeActionSource: () => source,
            }),
        );

        expect(await participant(SNAPSHOT)).toEqual([]);
        // «one\ntwo»: конец диапазона — строка 1, длина «two».
        expect(provided).toEqual([{ text: "one\ntwo", endLine: 1, endCharacter: 3 }]);
    });
});

describe("createFormatOnSaveParticipant", () => {
    it("настройка выключена — источник не дёргается", async () => {
        let called = false;
        const participant = createFormatOnSaveParticipant(
            host({
                configuration: config({}),
                formattingSource: () => () => {
                    called = true;
                    return Promise.resolve([]);
                },
            }),
        );
        expect(await participant(SNAPSHOT)).toEqual([]);
        expect(called).toBe(false);
    });

    it("включена, но панели нет (файл сохраняется без вью) — no-op", async () => {
        let called = false;
        const participant = createFormatOnSaveParticipant(
            host({
                configuration: config({ "editor.formatOnSave": true }),
                formattingSource: () => () => {
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
            viewState: { tabSize: 4, insertSpaces: true, selections: [] as ISelection[] },
            applyExternalEdits: () => {
                editsApplied++;
            },
        } as unknown as TextEditorPane;
        const participant = createFormatOnSaveParticipant(
            host({
                configuration: config({ "editor.formatOnSave": true }),
                formattingSource: () => () => Promise.resolve([]),
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
            viewState: { tabSize: 3, insertSpaces: false, selections: [] as ISelection[] },
            applyExternalEdits: () => undefined,
        } as unknown as TextEditorPane;
        const participant = createFormatOnSaveParticipant(
            host({
                configuration: config({ "editor.formatOnSave": true }),
                formattingSource: () => (req) => {
                    requests.push({ tabSize: req.tabSize, insertSpaces: req.insertSpaces });
                    return Promise.resolve(null);
                },
                paneForUri: () => pane,
            }),
        );

        expect(await participant(SNAPSHOT)).toEqual([]);
        expect(requests).toEqual([{ tabSize: 3, insertSpaces: false }]);
    });
});
