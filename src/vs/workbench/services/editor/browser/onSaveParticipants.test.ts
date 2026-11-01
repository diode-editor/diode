import { describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { ISelection } from "../../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type {
    IApplyCodeActionOptions,
    ICodeActionRequest,
    ICoreCodeAction,
} from "../../../../editor/common/languages/iCodeActionSource.ts";
import type { IFormattingRequest } from "../../../../editor/common/languages/iFormattingSource.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { ISaveSnapshot } from "../../textfile/common/iSaveParticipant.ts";
import { SAVE_PARTICIPANT_TIMEOUT_MS } from "../../textfile/common/textFileSaveParticipant.ts";

import {
    createCodeActionsOnSaveParticipant,
    createFormatOnSaveParticipant,
    enabledCodeActionKindsOnSave,
    type IOnSaveParticipantHost,
} from "./onSaveParticipants.ts";

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

interface IFakeCodeActions {
    provide(request: ICodeActionRequest): Promise<readonly ICoreCodeAction[] | null>;
    apply(id: string, options?: IApplyCodeActionOptions): Promise<boolean>;
}

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
            applyCodeAction: (id, options) => codeActions.apply(id, options),
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

describe("createFormatOnSaveParticipant: editor.defaultFormatter", () => {
    const providerRun = (extensionId: string, runs: string[]) => ({
        extensionId,
        provideDocumentFormattingEdits: () => {
            runs.push(extensionId);
            return Promise.resolve([]);
        },
    });

    function savingHost(settings: Record<string, unknown>, runs: string[]): IOnSaveParticipantHost {
        const languageFeatures = new LanguageFeaturesService();
        languageFeatures.documentFormattingEditProvider.register("*", providerRun("acme.first", runs));
        languageFeatures.documentFormattingEditProvider.register("*", providerRun("acme.second", runs));
        const pane = {
            model: { document: new TextDocument("x\n") },
            viewState: { tabSize: 4, insertSpaces: true },
        } as unknown as TextEditorPane;
        return { configuration: config(settings), languageFeatures, paneForUri: () => pane };
    }

    it("runs exactly the formatter named for the language, once", async () => {
        const runs: string[] = [];
        const settings = { "editor.formatOnSave": true, "[python]": { "editor.defaultFormatter": "acme.first" } };
        await createFormatOnSaveParticipant(savingHost(settings, runs))(SNAPSHOT);
        expect(runs).toEqual(["acme.first"]);
    });

    it("the request is cancelled at the save participant's deadline, not before", async () => {
        vi.useFakeTimers();
        try {
            let token: ICancellationToken | undefined;
            const languageFeatures = new LanguageFeaturesService();
            languageFeatures.documentFormattingEditProvider.register("*", {
                provideDocumentFormattingEdits: (_request, seen) => {
                    token = seen;
                    return new Promise(() => undefined);
                },
            });
            const pane = {
                model: { document: new TextDocument("x\n") },
                viewState: { tabSize: 4, insertSpaces: true },
            } as unknown as TextEditorPane;
            void createFormatOnSaveParticipant({
                configuration: config({ "editor.formatOnSave": true }),
                languageFeatures,
                paneForUri: () => pane,
            })(SNAPSHOT);

            vi.advanceTimersByTime(SAVE_PARTICIPANT_TIMEOUT_MS - 1);
            expect(token?.isCancellationRequested).toBe(false);
            vi.advanceTimersByTime(1);
            expect(token?.isCancellationRequested).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("a named formatter that is missing is a silent no-op on save", async () => {
        const runs: string[] = [];
        const settings = { "editor.formatOnSave": true, "editor.defaultFormatter": "acme.gone" };
        expect(await createFormatOnSaveParticipant(savingHost(settings, runs))(SNAPSHOT)).toEqual([]);
        expect(runs).toEqual([]);
    });
});

describe("enabledCodeActionKindsOnSave", () => {
    it("object: true/explicit/always enable, false/never/other do not", () => {
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

    it("array: strings are enabled, non-strings are filtered out", () => {
        expect(
            enabledCodeActionKindsOnSave(config({ "editor.codeActionsOnSave": ["source.fixAll", 5, null] })),
        ).toEqual(["source.fixAll"]);
    });

    it("the array form passes the app settings schema instead of being replaced by the default", () => {
        const configuration = createTestConfigurationService({
            "editor.codeActionsOnSave": ["source.organizeImports"],
        });
        expect(enabledCodeActionKindsOnSave(configuration)).toEqual(["source.organizeImports"]);
    });

    it("document language section: the object merges with the flat one (as in VS Code), another language gets only flat ones", () => {
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

    it("unset / null / non-object → empty", () => {
        expect(enabledCodeActionKindsOnSave(config({}))).toEqual([]);
        // A service without defaults (null stub) has no key at all.
        expect(enabledCodeActionKindsOnSave(NULL_CONFIGURATION_SERVICE)).toEqual([]);
        expect(enabledCodeActionKindsOnSave(config({ "editor.codeActionsOnSave": null }))).toEqual([]);
        expect(enabledCodeActionKindsOnSave(config({ "editor.codeActionsOnSave": "source.fixAll" }))).toEqual([]);
    });
});

describe("createCodeActionsOnSaveParticipant", () => {
    it("without a source: empty result, the setting is not even read", async () => {
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

    it("provide returned null (no matching provider): apply is not called", async () => {
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

    it("disabled actions are not applied on save, enabled ones are", async () => {
        const applied: [string, IApplyCodeActionOptions | undefined][] = [];
        const participant = createCodeActionsOnSaveParticipant(
            host({
                configuration: config({ "editor.codeActionsOnSave": { "source.fixAll": true } }),
                codeActions: {
                    provide: () =>
                        Promise.resolve([
                            { id: "1.0", title: "Fix all", disabled: "Nothing to fix" },
                            { id: "1.1", title: "Fix lint" },
                        ]),
                    apply: (id, options) => {
                        applied.push([id, options]);
                        return Promise.resolve(true);
                    },
                },
            }),
        );

        expect(await participant(SNAPSHOT)).toEqual([]);
        // "On save" reason: the edits are not subject to files.refactoring.autoSave.
        expect(applied).toEqual([["1.1", { onSave: true }]]);
    });

    it("without a pane the range and version come from the snapshot", async () => {
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
        // "one\ntwo": the range ends on line 1, at the length of "two".
        expect(provided).toEqual([{ versionId: 7, endLine: 1, endCharacter: 3 }]);
    });

    it("with a pane the range and version come from the pane, not the snapshot", async () => {
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

function fakePane(
    getText: () => string,
    versionId: () => number = () => 1,
): {
    pane: TextEditorPane;
    applied: { edits: number; label: string }[];
} {
    const applied: { edits: number; label: string }[] = [];
    // Participants compute the range from document lines; the pane's full text
    // is read only when applying format edits (`applyFormattingEdits`).
    const pane = {
        getText,
        model: {
            get document() {
                const lines = getText().split("\n");
                return {
                    versionId: versionId(),
                    lineCount: lines.length,
                    getLineLength: (line: number) => lines[line].length,
                };
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
    it("setting disabled: the source is not called even with a live pane", async () => {
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

    it("enabled only in the document language section: the participant works for it, not for others", async () => {
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

    it("enabled, a pane exists, but no source (host dropped): no-op", async () => {
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

    it("successful format: edits are applied with the Format on Save label, the result is empty", async () => {
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

    it("a stale response (version changed during the RPC): edits are not applied", async () => {
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

    it("enabled but no pane (file saved without a view): no-op", async () => {
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

    it("an empty formatter response (nothing to change): no-op without edits", async () => {
        let editsApplied = 0;
        const pane = {
            model: { document: { versionId: 1, lineCount: 1, getLineLength: () => 1 } },
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

    it("the request's indentation settings come from the pane's viewState", async () => {
        const requests: { tabSize: number; insertSpaces: boolean }[] = [];
        const pane = {
            model: { document: { versionId: 1, lineCount: 1, getLineLength: () => 1 } },
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

    it("the request carries the pane version; a range formatter gets the range of the pane's whole text", async () => {
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
