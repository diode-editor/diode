import { describe, expect, it, vi } from "vitest";

import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";

import { FormatOnTypeService } from "./formatOnTypeService.ts";

function makePane(): TextEditorPane<TextFileModel> {
    const pane = createEditorPane();
    pane.viewState.document.applyEdits([{ range: createRange(0, 0, 0, 0), text: "a" }]);
    pane.viewState.selections = [createCursorSelection(0, 1)];
    return pane;
}

function setup(settings: (overrideIdentifier: string | undefined) => boolean) {
    const pane = makePane();
    const active = new Emitter<TextEditorPane | null>();
    let current: TextEditorPane | null = pane;
    const group = {
        getActiveEditor: () => current,
        onActiveEditorChanged: active.event,
    } as unknown as IEditorService;
    const features = new LanguageFeaturesService();
    const provide = vi.fn(() => Promise.resolve([{ range: createRange(0, 0, 0, 0), text: "#" }]));
    features.onTypeFormattingEditProvider.register("*", {
        triggerCharacters: [";"],
        provideOnTypeFormattingEdits: provide,
    });
    const get = vi.fn((_key: string, overrides?: { overrideIdentifier?: string }) =>
        settings(overrides?.overrideIdentifier),
    );
    const service = new FormatOnTypeService(group, features, { get } as unknown as IConfigurationService);
    return {
        pane,
        provide,
        get,
        service,
        activate(next: TextEditorPane | null) {
            current = next;
            active.fire(next);
        },
    };
}

describe("FormatOnTypeService", () => {
    it("the setting is read for the editor's language", () => {
        const { pane, provide, get, service } = setup(() => true);
        pane.typeText(";");
        expect(get).toHaveBeenCalledWith("editor.formatOnType", { overrideIdentifier: pane.languageId });
        expect(provide).toHaveBeenCalledOnce();
        service.dispose();
    });

    it("the setting off leaves the text alone", async () => {
        const { pane, provide, service } = setup(() => false);
        pane.typeText(";");
        await Promise.resolve();
        expect(provide).not.toHaveBeenCalled();
        expect(pane.viewState.document.getText()).toBe("a;");
        service.dispose();
    });

    it("follows the active editor", () => {
        const { pane, provide, activate, service } = setup(() => true);
        const other = makePane();
        activate(other);
        pane.typeText(";");
        expect(provide).not.toHaveBeenCalled();
        other.typeText(";");
        expect(provide).toHaveBeenCalledOnce();

        activate(null);
        other.typeText(";");
        expect(provide).toHaveBeenCalledOnce();
        service.dispose();
    });

    it("disposing it stops listening", () => {
        const { pane, provide, service } = setup(() => true);
        service.dispose();
        pane.typeText(";");
        expect(provide).not.toHaveBeenCalled();
    });
});
