import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditorPane } from "../../../../TestUtils/TextEditorPaneFactory.ts";
import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { LanguageFeatureRegistry } from "../../../editor/common/languageFeatureRegistry.ts";
import type { CodeLensProvider } from "../../../editor/common/languages/iCodeLensSource.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";
import { QuickInputComponent } from "../parts/quickinput/quickInputComponent.ts";
import { QuickInputService, QuickInputServiceDIToken } from "../parts/quickinput/quickInputService.ts";

import { showLensesInCurrentLineAction } from "./editorActions.ts";

describe("Show CodeLens Commands for Current Line — the picker's frame", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows an icon in a title the way the lens row does, never the raw $(name) syntax", async () => {
        const component = new QuickInputComponent();
        const service = new QuickInputService(component);
        const body = new BodyElement();
        const size = new Size(80, 24);
        const app = TestApp.create(body, size);
        component.attachHost(body);

        const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
        const providers = new LanguageFeatureRegistry<CodeLensProvider>();
        providers.register("*", {
            provideCodeLenses: () => ({
                lenses: [
                    { range, command: { id: "cmd.known", title: "$(play) Run" } },
                    { range, command: { id: "cmd.unknown", title: "$(nosuchicon)Debug" } },
                ],
                dispose: () => undefined,
            }),
        });
        const editor = createEditorPane({
            codeLens: { providers, runCommand: () => Promise.resolve() },
        });
        await vi.advanceTimersByTimeAsync(1000);

        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ({ getActiveEditor: () => editor }) as never);
        accessor.bind(QuickInputServiceDIToken, () => service);

        const running = showLensesInCurrentLineAction.run(accessor);
        await vi.advanceTimersByTimeAsync(0);
        app.render();
        const frame = Array.from({ length: size.height }, (_, y) =>
            app.backend.getTextAt(new Point(0, y), size.width),
        ).join("\n");
        app.sendKey("Escape");
        await running;
        editor.dispose();

        expect(frame).toContain("Run");
        expect(frame).toContain("Debug");
        expect(frame).not.toContain("$(");
    });
});
