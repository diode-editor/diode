import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";
import { QuickInputComponent } from "../parts/quickinput/quickInputComponent.ts";
import { QuickInputService, QuickInputServiceDIToken } from "../parts/quickinput/quickInputService.ts";

import { showLensesInCurrentLineAction } from "./editorActions.ts";

describe("Show CodeLens Commands for Current Line — the picker's frame", () => {
    it("shows an icon in a title the way the lens row does, never the raw $(name) syntax", async () => {
        const component = new QuickInputComponent();
        const service = new QuickInputService(component);
        const body = new BodyElement();
        const size = new Size(80, 24);
        const app = TestApp.create(body, size);
        component.attachHost(body);

        const editor = {
            viewState: { primaryCursorLine: 0 },
            getCodeLensCommandsAtLine: () =>
                Promise.resolve([
                    { id: "cmd.known", title: "$(play) Run" },
                    { id: "cmd.unknown", title: "$(nosuchicon)Debug" },
                ]),
        };
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ({ getActiveEditor: () => editor }) as never);
        accessor.bind(QuickInputServiceDIToken, () => service);

        const running = showLensesInCurrentLineAction.run(accessor);
        await Promise.resolve();
        await Promise.resolve();
        app.render();
        const frame = Array.from({ length: size.height }, (_, y) =>
            app.backend.getTextAt(new Point(0, y), size.width),
        ).join("\n");
        app.sendKey("Escape");
        await running;

        expect(frame).toContain("Run");
        expect(frame).toContain("Debug");
        expect(frame).not.toContain("$(");
    });
});
