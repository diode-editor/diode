import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import type { ILanguageConfigurationService } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import { EMPTY_LANGUAGE_CONFIGURATION } from "../../../../editor/common/languages/languageConfiguration.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";

import { cancelLinkedEditingInputAction, startLinkedEditingAction } from "./linkedEditingActions.ts";
import { LinkedEditingService } from "./linkedEditingService.ts";

const SETTLE_MS = 300;
const OPEN = createRange(0, 1, 0, 4);
const CLOSE = createRange(0, 7, 0, 10);

function setup(initial = true, wordPattern?: RegExp) {
    const pane = createEditorPane();
    pane.viewState.document.applyEdits([{ range: createRange(0, 0, 0, 0), text: "<aaa></aaa>" }]);
    const active = new Emitter<TextEditorPane | null>();
    let current: TextEditorPane | null = pane;
    const group = {
        getActiveEditor: () => current,
        onActiveEditorChanged: active.event,
    } as unknown as IEditorService;
    const features = new LanguageFeaturesService();
    const provider = features.linkedEditingRangeProvider.register("*", {
        provideLinkedEditingRanges: () => Promise.resolve({ ranges: [OPEN, CLOSE] }),
    });
    let setting = initial;
    const changes = new Emitter<{ affectsConfiguration(key: string): boolean }>();
    const get = vi.fn((_key: string, _overrides?: { overrideIdentifier?: string }) => setting);
    const configuration = { get, onDidChangeConfiguration: changes.event };
    const languageConfiguration: ILanguageConfigurationService = {
        get: () => ({ ...EMPTY_LANGUAGE_CONFIGURATION, wordPattern }),
        ensureLoaded: vi.fn(() => Promise.resolve(EMPTY_LANGUAGE_CONFIGURATION)),
        register: () => ({ dispose: () => undefined }),
    };
    const service = new LinkedEditingService(
        group,
        features,
        configuration as unknown as IConfigurationService,
        languageConfiguration,
    );
    return {
        pane,
        service,
        features,
        provider,
        get,
        languageConfiguration,
        setSetting(value: boolean, key = "editor.linkedEditing") {
            setting = value;
            changes.fire({ affectsConfiguration: (changed) => changed === key });
        },
        switchTo(editor: TextEditorPane | null) {
            current = editor;
            active.fire(editor);
        },
        dispose() {
            service.dispose();
            pane.dispose();
        },
    };
}

describe("LinkedEditingService", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("the setting on: the active editor is linked and mirrors", async () => {
        const t = setup();
        t.pane.viewState.selections = [createCursorSelection(0, 2)];
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(t.pane.viewState.linkedEditingRanges).toEqual([OPEN, CLOSE]);
        t.pane.pushUndo(t.pane.viewState.type("x"));
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(t.pane.viewState.document.getText()).toBe("<axaa></axaa>");
        t.dispose();
    });

    it("the setting off: nothing until the command", async () => {
        const t = setup(false);
        t.pane.viewState.selections = [createCursorSelection(0, 2)];
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(t.pane.viewState.linkedEditingRanges).toEqual([]);
        await t.service.start();
        expect(t.pane.viewState.linkedEditingRanges).toEqual([OPEN, CLOSE]);
        t.service.cancel();
        expect(t.pane.viewState.linkedEditingRanges).toEqual([]);
        t.dispose();
    });

    it("the setting is read for the editor's language", async () => {
        const t = setup();
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(t.get).toHaveBeenCalledWith("editor.linkedEditing", { overrideIdentifier: t.pane.languageId });
        t.dispose();
    });

    it("the setting changing takes effect at once; another key changes nothing", async () => {
        const t = setup(false);
        t.pane.viewState.selections = [createCursorSelection(0, 2)];
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        t.setSetting(true, "editor.fontSize");
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(t.pane.viewState.linkedEditingRanges).toEqual([]);
        t.setSetting(true);
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(t.pane.viewState.linkedEditingRanges).toEqual([OPEN, CLOSE]);
        t.setSetting(false);
        expect(t.pane.viewState.linkedEditingRanges).toEqual([]);
        t.dispose();
    });

    it("the language's word pattern ends the link when the answer has none", async () => {
        const t = setup(true, /[a-z]+/);
        t.pane.viewState.selections = [createCursorSelection(0, 2)];
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        t.pane.pushUndo(t.pane.viewState.type("1"));
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(t.pane.viewState.document.getText()).toBe("<a1aa></aaa>");
        t.dispose();
    });

    it("the language configuration is warmed up for the active editor", () => {
        const t = setup();
        expect(t.languageConfiguration.ensureLoaded).toHaveBeenCalledWith(t.pane.languageId);
        t.dispose();
    });

    it("another active editor takes the ranges off the old one", async () => {
        const t = setup();
        t.pane.viewState.selections = [createCursorSelection(0, 2)];
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        t.switchTo(null);
        expect(t.pane.viewState.linkedEditingRanges).toEqual([]);
        await t.service.start();
        t.service.cancel();
        expect(t.pane.viewState.linkedEditingRanges).toEqual([]);
        t.dispose();
    });

    it("the provider going away ends the link; another registration links again", async () => {
        const t = setup();
        t.pane.viewState.selections = [createCursorSelection(0, 2)];
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        t.provider.dispose();
        expect(t.pane.viewState.linkedEditingRanges).toEqual([]);
        t.features.linkedEditingRangeProvider.register("*", {
            provideLinkedEditingRanges: () => Promise.resolve({ ranges: [OPEN, CLOSE] }),
        });
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(t.pane.viewState.linkedEditingRanges).toEqual([OPEN, CLOSE]);
        t.dispose();
    });

    it("without an active editor nothing breaks: registrations, settings and the language pattern", async () => {
        const t = setup();
        t.switchTo(null);
        t.features.linkedEditingRangeProvider.register("*", {
            provideLinkedEditingRanges: () => Promise.resolve(null),
        });
        t.setSetting(false);
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(t.pane.viewState.linkedEditingRanges).toEqual([]);
        t.dispose();
    });

    it("a registration or a setting that changes nothing keeps the ranges and does not ask", async () => {
        const t = setup();
        t.pane.viewState.selections = [createCursorSelection(0, 2)];
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        const repaint = vi.fn();
        t.pane.viewState.onDidChangeLinkedEditingRanges(repaint);
        t.features.linkedEditingRangeProvider.register("*", {
            provideLinkedEditingRanges: () => Promise.resolve({ ranges: [OPEN, CLOSE] }),
        });
        t.setSetting(true);
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(repaint).not.toHaveBeenCalled();
        t.dispose();
    });

    it("a language configuration not loaded yet falls back to the default word", async () => {
        const t = setup();
        vi.spyOn(t.languageConfiguration, "get").mockReturnValue(undefined);
        t.pane.viewState.selections = [createCursorSelection(0, 2)];
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        t.pane.pushUndo(t.pane.viewState.type("1"));
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(t.pane.viewState.document.getText()).toBe("<a1aa></a1aa>");
        t.dispose();
    });

    it("the language changing asks anew", async () => {
        const t = setup();
        t.pane.viewState.selections = [createCursorSelection(0, 2)];
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        vi.mocked(t.languageConfiguration.ensureLoaded).mockClear();
        const repaint = vi.fn();
        t.pane.viewState.onDidChangeLinkedEditingRanges(repaint);
        t.pane.viewState.document.setLanguage("typescript");
        expect(t.languageConfiguration.ensureLoaded).toHaveBeenCalledTimes(1);
        // The old ranges went at once, the new answer brought them back.
        expect(repaint).toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(t.pane.viewState.linkedEditingRanges).toEqual([OPEN, CLOSE]);
        t.dispose();
    });

    it("dispose leaves nothing on the frame", async () => {
        const t = setup();
        t.pane.viewState.selections = [createCursorSelection(0, 2)];
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        t.service.dispose();
        expect(t.pane.viewState.linkedEditingRanges).toEqual([]);
        t.pane.dispose();
    });
});

describe("linked editing actions", () => {
    it("Start Linked Editing: upstream's id, keys and precondition", () => {
        expect(startLinkedEditingAction).toMatchObject({
            id: "editor.action.linkedEditing",
            title: "Start Linked Editing",
            when: "editorTextFocus",
            enablement: "!editorReadonly && editorHasRenameProvider",
        });
    });

    it("both run the service", async () => {
        const service = { start: vi.fn(() => Promise.resolve()), cancel: vi.fn() };
        const accessor = { get: () => service } as unknown as Parameters<typeof startLinkedEditingAction.run>[0];
        await startLinkedEditingAction.run(accessor);
        expect(service.start).toHaveBeenCalledTimes(1);
        await cancelLinkedEditingInputAction.run(accessor);
        expect(service.cancel).toHaveBeenCalledTimes(1);
    });

    it("cancelLinkedEditingInput outweighs the other Escape handlers of the editor", () => {
        expect(cancelLinkedEditingInputAction).toMatchObject({
            id: "cancelLinkedEditingInput",
            enablement: "LinkedEditingInputVisible",
            weight: 199,
        });
    });
});
