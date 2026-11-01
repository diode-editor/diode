import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_CONFIGURATION_SERVICE } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { SyntheticTextModel } from "../../../common/editor/syntheticTextModel.ts";
import { TextFileModel } from "../../textfile/common/textFileModel.ts";

import { TextEditorPaneBuilder } from "./textEditorPaneBuilder.ts";

describe("TextEditorPaneBuilder — inlay hints", () => {
    function setup() {
        const features = new LanguageFeaturesService();
        const provideInlayHints = vi.fn(() => null);
        features.inlayHintsProvider.register("*", { provideInlayHints });
        const builder = new TextEditorPaneBuilder(
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            NULL_LANGUAGE_CONFIGURATION_SERVICE,
            features,
            createTestEditorContextMenuController(),
        );
        return { builder, provideInlayHints };
    }

    it("a file editor asks the providers, once it is built: the document is not synced before that", async () => {
        const { builder, provideInlayHints } = setup();
        const pane = builder.build(new TextFileModel(NULL_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService()));
        expect(provideInlayHints).not.toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(provideInlayHints).toHaveBeenCalledOnce();
        });
        pane.dispose();
    });

    it("a panel or a virtual document (a synthetic model) does not", () => {
        const { builder, provideInlayHints } = setup();
        const model = new SyntheticTextModel(
            NULL_LANGUAGE_SERVICE,
            new UndoRedoService(),
            Uri.parse("output:channel"),
            "plaintext",
        );
        const pane = builder.build(model);
        expect(provideInlayHints).not.toHaveBeenCalled();
        pane.dispose();
    });
});

describe("TextEditorPaneBuilder — code lens", () => {
    function setup() {
        const features = new LanguageFeaturesService();
        const provideCodeLenses = vi.fn(() => null);
        features.codeLensProvider.register("*", { provideCodeLenses });
        const builder = new TextEditorPaneBuilder(
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            NULL_LANGUAGE_CONFIGURATION_SERVICE,
            features,
            createTestEditorContextMenuController(),
        );
        return { builder, provideCodeLenses };
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("a file editor asks the providers", async () => {
        const { builder, provideCodeLenses } = setup();
        const pane = builder.build(new TextFileModel(NULL_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService()));
        await vi.advanceTimersByTimeAsync(1000);
        expect(provideCodeLenses).toHaveBeenCalledOnce();
        pane.dispose();
    });

    it("a click on a title reaches the command registry", async () => {
        const features = new LanguageFeaturesService();
        const lens = {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            command: { id: "cmd.run", title: "run", arguments: [7] },
        };
        features.codeLensProvider.register("*", {
            provideCodeLenses: () => ({ lenses: [lens], dispose: () => undefined }),
        });
        const execute = vi.fn(() => Promise.resolve());
        const builder = new TextEditorPaneBuilder(
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            NULL_LANGUAGE_CONFIGURATION_SERVICE,
            features,
            createTestEditorContextMenuController(),
            undefined,
            { has: () => true, execute } as never,
        );
        const pane = builder.build(new TextFileModel(NULL_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService()));
        const app = TestApp.createWithContent(pane.view, new Size(40, 8));
        await vi.advanceTimersByTimeAsync(1000);
        app.render();
        // Gutter: 2 padding + 1 digit + fold margin (3).
        const x = 6;
        pane.component.view
            .getChild()
            .dispatchEvent(
                new TUIMouseEvent("mousedown", { button: "left", screenX: x, screenY: 0, localX: x, localY: 0 }),
            );
        expect(execute).toHaveBeenCalledWith("cmd.run", 7);
        pane.dispose();
    });

    it("a panel or a virtual document (a synthetic model) does not", async () => {
        const { builder, provideCodeLenses } = setup();
        const model = new SyntheticTextModel(
            NULL_LANGUAGE_SERVICE,
            new UndoRedoService(),
            Uri.parse("output:channel"),
            "plaintext",
        );
        const pane = builder.build(model);
        await vi.advanceTimersByTimeAsync(1000);
        expect(provideCodeLenses).not.toHaveBeenCalled();
        pane.dispose();
    });
});
