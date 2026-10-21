import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ICodeActionRequest, ICoreCodeAction } from "../../../../editor/common/languages/iCodeActionSource.ts";
import type { IFormattingRequest } from "../../../../editor/common/languages/iFormattingSource.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

// Hermetic contract (#196); the stock stack is covered by the network suite extensionHost.ruffLsp.onSave.test.ts.

function stubConfigurationService(values: Record<string, unknown>): IConfigurationService {
    return createTestConfigurationService(values);
}

const registries = new WeakMap<EditorService, LanguageFeaturesService>();

function createEditorService(configuration: Record<string, unknown> = {}): EditorService {
    const languageFeatures = new LanguageFeaturesService();
    const service = new EditorService(
        new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        NULL_LANGUAGE_SERVICE,
        stubConfigurationService(configuration),
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
        undefined,
        undefined,
        [],
        languageFeatures,
        diskFileService(),
    );
    registries.set(service, languageFeatures);
    return service;
}

function useCodeActions(
    ctrl: EditorService,
    source: {
        provide(request: ICodeActionRequest): Promise<readonly ICoreCodeAction[] | null>;
        apply(id: string): Promise<boolean>;
    },
): void {
    registries.get(ctrl)?.codeActionProvider.register("*", {
        providedCodeActionKinds: [],
        provideCodeActions: async (request) => (await source.provide(request)) ?? [],
        applyCodeAction: (id) => source.apply(id),
    });
}

function useFormatter(
    ctrl: EditorService,
    format: (request: IFormattingRequest) => Promise<readonly ITextEdit[] | null>,
): void {
    registries.get(ctrl)?.documentFormattingEditProvider.register("*", {
        provideDocumentFormattingEdits: async (request) => (await format(request)) ?? [],
    });
}

describe("EditorService — save driven by onSave settings", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-onsave-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string, content: string): string {
        const fp = path.join(ws.dir, name);
        fs.writeFileSync(fp, content, "utf-8");
        return fp;
    }

    describe("editor.codeActionsOnSave", () => {
        it("providers of another language do not enable the participant: save does not wake them", async () => {
            const ctrl = createEditorService({
                "editor.codeActionsOnSave": { "source.fixAll": true },
                "editor.formatOnSave": true,
            });
            const fp = writeFile("a.txt", "import sys\n");
            ctrl.openFile(fp);
            const pane = ctrl.getActiveEditor()!;
            let asked = 0;
            const registry = registries.get(ctrl)!;
            registry.codeActionProvider.register("python", {
                providedCodeActionKinds: [],
                provideCodeActions: () => {
                    asked++;
                    return Promise.resolve([]);
                },
                applyCodeAction: () => Promise.resolve(true),
            });
            registry.documentFormattingEditProvider.register("python", {
                provideDocumentFormattingEdits: () => {
                    asked++;
                    return Promise.resolve([]);
                },
            });

            await pane.save();

            expect(asked).toBe(0);
            expect(fs.readFileSync(fp, "utf-8")).toBe("import sys\n");
        });

        it("runs the enabled kind: provide with only and the full range, apply of all actions in order", async () => {
            const ctrl = createEditorService({ "editor.codeActionsOnSave": { "source.fixAll": true } });
            const fp = writeFile("a.txt", "import sys\nimport os\n");
            ctrl.openFile(fp);
            const pane = ctrl.getActiveEditor()!;
            const versionBefore = pane.model.document.versionId;

            const provided: ICodeActionRequest[] = [];
            const applied: string[] = [];
            useCodeActions(ctrl, {
                provide: (req) => {
                    provided.push(req);
                    return Promise.resolve([
                        { id: "fix.1", title: "Fix all", kind: "source.fixAll.fake" },
                        { id: "fix.2", title: "Fix more", kind: "source.fixAll.fake" },
                    ]);
                },
                apply: (id) => {
                    applied.push(id);
                    // The subprocess applies edits itself (workspace.applyEdit); simulate that.
                    if (id === "fix.1") {
                        pane.applyExternalEdits([createTextEdit(createRange(0, 0, 1, 0), "")], "fix");
                    }
                    return Promise.resolve(true);
                },
            });

            await pane.save();

            expect(provided).toHaveLength(1);
            expect(provided[0].only).toBe("source.fixAll");
            expect(provided[0].languageId).toBe("plaintext");
            // Full document range: 3 "lines" after splitting, the last one empty.
            expect(provided[0].range).toEqual(createRange(0, 0, 2, 0));
            expect(provided[0].versionId).toBe(versionBefore);
            expect(pane.model.document.versionId).not.toBe(versionBefore);
            expect(applied).toEqual(["fix.1", "fix.2"]);
            expect(fs.readFileSync(fp, "utf-8")).toBe("import os\n");
            ctrl.dispose();
        });

        it("a hierarchical kind key goes to only as is", async () => {
            const ctrl = createEditorService({
                "editor.codeActionsOnSave": { "source.organizeImports.ruff": "explicit" },
            });
            ctrl.openFile(writeFile("b.txt", "x"));

            const onlySeen: (string | undefined)[] = [];
            useCodeActions(ctrl, {
                provide: (req) => {
                    onlySeen.push(req.only);
                    return Promise.resolve([]);
                },
                apply: () => Promise.resolve(true),
            });

            await ctrl.getActiveEditor()!.save();

            expect(onlySeen).toEqual(["source.organizeImports.ruff"]);
            ctrl.dispose();
        });

        it("several enabled kinds run in key order, disabled values are skipped", async () => {
            const ctrl = createEditorService({
                "editor.codeActionsOnSave": {
                    "source.fixAll": true,
                    "source.unknown": false,
                    "source.never": "never",
                    "source.organizeImports": "always",
                },
            });
            ctrl.openFile(writeFile("c.txt", "x"));

            const onlySeen: (string | undefined)[] = [];
            useCodeActions(ctrl, {
                provide: (req) => {
                    onlySeen.push(req.only);
                    return Promise.resolve(null);
                },
                apply: () => Promise.resolve(true),
            });

            await ctrl.getActiveEditor()!.save();

            expect(onlySeen).toEqual(["source.fixAll", "source.organizeImports"]);
            ctrl.dispose();
        });

        it("the array form of the setting enables the listed kinds", async () => {
            const ctrl = createEditorService({ "editor.codeActionsOnSave": ["source.fixAll"] });
            ctrl.openFile(writeFile("d.txt", "x"));

            const onlySeen: (string | undefined)[] = [];
            useCodeActions(ctrl, {
                provide: (req) => {
                    onlySeen.push(req.only);
                    return Promise.resolve([]);
                },
                apply: () => Promise.resolve(true),
            });

            await ctrl.getActiveEditor()!.save();

            expect(onlySeen).toEqual(["source.fixAll"]);
            ctrl.dispose();
        });
    });

    describe("editor.formatOnSave", () => {
        it("formatter edits land in the buffer and on disk, the cursor collapses to its previous position", async () => {
            const ctrl = createEditorService({ "editor.formatOnSave": true });
            const fp = writeFile("f.txt", "a  =  1\nb=2\n");
            ctrl.openFile(fp);
            const pane = ctrl.getActiveEditor()!;
            pane.viewState.selections = [createCursorSelection(1, 1), createCursorSelection(0, 2)];
            const versionBefore = pane.model.document.versionId;

            const requests: IFormattingRequest[] = [];
            useFormatter(ctrl, (req) => {
                requests.push(req);
                return Promise.resolve([createTextEdit(createRange(0, 0, 0, 7), "a = 1")]);
            });

            await pane.save();

            expect(requests).toHaveLength(1);
            expect(requests[0].versionId).toBe(versionBefore);
            expect(requests[0].range).toBeUndefined();
            expect(fs.readFileSync(fp, "utf-8")).toBe("a = 1\nb=2\n");
            // The viewState setter sorts multi-cursors by position, so the primary is (0,2).
            expect(pane.viewState.selections).toHaveLength(1);
            expect(pane.viewState.selections[0].active).toEqual({ line: 0, character: 2 });
            ctrl.dispose();
        });

        it("enabled only by the document language section: the participant is listed for that language", async () => {
            const ctrl = createEditorService({ "[plaintext]": { "editor.formatOnSave": true } });
            const fp = writeFile("lang.txt", "x\n");
            ctrl.openFile(fp);
            let calls = 0;
            useFormatter(ctrl, () => {
                calls++;
                return Promise.resolve([]);
            });

            await ctrl.getActiveEditor()!.save();

            expect(calls).toBe(1);
            ctrl.dispose();
        });

        it("a stale formatter response (text changed during the RPC) is dropped", async () => {
            const ctrl = createEditorService({ "editor.formatOnSave": true });
            const fp = writeFile("stale.txt", "old\n");
            ctrl.openFile(fp);
            const pane = ctrl.getActiveEditor()!;

            useFormatter(ctrl, () => {
                // While the "formatter is thinking", the buffer changes (a race with the user).
                pane.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "typed:")], "user");
                return Promise.resolve([createTextEdit(createRange(0, 0, 0, 3), "NEW")]);
            });

            await pane.save();

            expect(fs.readFileSync(fp, "utf-8")).toBe("typed:old\n");
            ctrl.dispose();
        });

        it("no formatter: save silently works", async () => {
            const ctrl = createEditorService({ "editor.formatOnSave": true });
            const fp = writeFile("nofmt.txt", "x");
            ctrl.openFile(fp);

            const outcome = await ctrl.getActiveEditor()!.save();

            expect(outcome).toBe("saved");
            ctrl.dispose();
        });
    });

    describe("composition", () => {
        it("VS Code order: code actions → format → extension will-save, each on fresh text", async () => {
            const ctrl = createEditorService({
                "editor.codeActionsOnSave": { "source.fixAll": true },
                "editor.formatOnSave": true,
            });
            const fp = writeFile("pipe.txt", "base\n");
            ctrl.openFile(fp);
            const pane = ctrl.getActiveEditor()!;

            const order: string[] = [];
            let afterFix: number | undefined;
            useCodeActions(ctrl, {
                provide: () => {
                    order.push("actions");
                    return Promise.resolve([{ id: "a", title: "fix" }]);
                },
                apply: () => {
                    pane.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "fixed:")], "fix");
                    afterFix = pane.model.document.versionId;
                    return Promise.resolve(true);
                },
            });
            useFormatter(ctrl, (req) => {
                order.push("format");
                // Format must see the version AFTER the code action.
                expect(afterFix).toBeDefined();
                expect(req.versionId).toBe(afterFix);
                return Promise.resolve([createTextEdit(createRange(0, 0, 0, 0), "fmt:")]);
            });
            ctrl.saveParticipant = (snapshot) => {
                order.push("willSave");
                expect(snapshot.text).toBe("fmt:fixed:base\n");
                return Promise.resolve([]);
            };

            await pane.save();

            expect(order).toEqual(["actions", "format", "willSave"]);
            expect(fs.readFileSync(fp, "utf-8")).toBe("fmt:fixed:base\n");
            ctrl.dispose();
        });

        it("with defaults the sources are not called and save stays synchronous", async () => {
            const ctrl = createEditorService();
            const fp = writeFile("off.txt", "as is\n");
            ctrl.openFile(fp);

            let touched = 0;
            useCodeActions(ctrl, {
                provide: () => {
                    touched++;
                    return Promise.resolve([]);
                },
                apply: () => {
                    touched++;
                    return Promise.resolve(true);
                },
            });
            useFormatter(ctrl, () => {
                touched++;
                return Promise.resolve([]);
            });

            fs.rmSync(fp);
            await ctrl.getActiveEditor()!.save();

            expect(fs.readFileSync(fp, "utf-8")).toBe("as is\n");
            expect(touched).toBe(0);
            ctrl.dispose();
        });

        it("setting enabled but its source is not connected: the participant is not listed", async () => {
            // Gates are pairwise: codeActions without a source and format with the setting off must both drop out.
            const ctrl = createEditorService({ "editor.codeActionsOnSave": { "source.fixAll": true } });
            const fp = writeFile("halfoff.txt", "x\n");
            ctrl.openFile(fp);
            let formatCalled = 0;
            useFormatter(ctrl, () => {
                formatCalled++;
                return Promise.resolve([]);
            });

            fs.rmSync(fp);
            await expect(ctrl.getActiveEditor()!.save()).resolves.toBe("saved");

            expect(fs.readFileSync(fp, "utf-8")).toBe("x\n");
            expect(formatCalled).toBe(0);
            ctrl.dispose();
        });

        it("saveAs of a model without a view (diff side): no pane found, participants no-op, write works", async () => {
            const ctrl = createEditorService({
                "editor.codeActionsOnSave": { "source.fixAll": true },
                "editor.formatOnSave": true,
            });
            // A model WITHOUT a pane, like the editable side of Compare Untitled.
            const model = ctrl.textFileModels.createUntitledModel();
            useCodeActions(ctrl, {
                provide: () => Promise.resolve([]),
                apply: () => Promise.resolve(true),
            });
            let formatCalled = 0;
            useFormatter(ctrl, () => {
                formatCalled++;
                return Promise.resolve([]);
            });

            const dst = path.join(ws.dir, "untitled-dst.txt");
            await model.saveAs(dst);

            expect(fs.existsSync(dst)).toBe(true);
            expect(formatCalled).toBe(0);
            ctrl.dispose();
        });

        it("settings enabled but no sources (host not connected): save works", async () => {
            const ctrl = createEditorService({
                "editor.codeActionsOnSave": { "source.fixAll": true },
                "editor.formatOnSave": true,
            });
            const fp = writeFile("nosrc.txt", "x");
            ctrl.openFile(fp);

            fs.rmSync(fp);
            await expect(ctrl.getActiveEditor()!.save()).resolves.toBe("saved");

            expect(fs.readFileSync(fp, "utf-8")).toBe("x");
            ctrl.dispose();
        });

        it("format uses the pane of the file BEING SAVED, not the first one found", async () => {
            const ctrl = createEditorService({ "editor.formatOnSave": true });
            writeFile("first.txt", "first\n");
            const fp = writeFile("second.txt", "second\n");
            ctrl.openFile(path.join(ws.dir, "first.txt"));
            // Make pane versions diverge: edit first.txt twice.
            const first = ctrl.getActiveEditor()!;
            first.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "a")], "edit");
            first.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "b")], "edit");
            ctrl.openFile(fp);
            const second = ctrl.getActiveEditor()!;
            expect(second).not.toBe(first);
            expect(second.model.document.versionId).not.toBe(first.model.document.versionId);

            const versions: number[] = [];
            useFormatter(ctrl, (req) => {
                versions.push(req.versionId);
                return Promise.resolve([]);
            });

            await second.save();

            // The pane is looked up by the snapshot's uri: the request must carry second.txt's version.
            expect(versions).toEqual([second.model.document.versionId]);
            ctrl.dispose();
        });
    });
});
