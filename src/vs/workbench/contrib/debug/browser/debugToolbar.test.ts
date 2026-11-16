// DebugToolbar on fakes: what the workbench never hands it — a group without an overlay host, a menu without
// buttons, an item without an icon color (as an extension's would be).

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { OverlayHostElement } from "@tuidom/elements/contextview/overlayHostElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { Emitter } from "../../../../base/common/event.ts";
import type { IMenuEntryGroup } from "../../../../platform/actions/common/menuRegistry.ts";
import { StaticProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { GroupCornerStack } from "../../../browser/parts/editor/groupCornerStack.ts";
import { State } from "../common/debug.ts";

import { DebugToolbar } from "./debugToolbar.ts";

const NO_EVENT = () => ({ dispose: () => undefined });

function setup(
    groups: IMenuEntryGroup[],
    host: OverlayHostElement | null,
    debug: { state: State; initializingOptions?: { suppressDebugToolbar?: boolean } } = { state: State.Stopped },
) {
    const activeGroup = new Emitter<never>();
    let currentHost = host;
    const toolbar = new DebugToolbar(
        {
            state: debug.state,
            onDidChangeState: NO_EVENT,
            getModel: () => ({ getSessions: () => [{ suppressDebugToolbar: false }] }) as never,
            initializingOptions: debug.initializingOptions,
        },
        { groupOverlayHost: () => currentHost },
        new GroupCornerStack(),
        { activeGroup: { id: 1 } as never, onDidActiveGroupChange: activeGroup.event },
        {
            getEntryGroups: () => groups,
            createMenu: () => ({ onDidChange: NO_EVENT, dispose: () => undefined }) as never,
        },
        { onDidChange: NO_EVENT },
        createTestConfigurationService(),
        new StaticProductIconService(false),
    );
    return {
        toolbar,
        /** The active group changes to one the view layer knows. */
        attach: (next: OverlayHostElement): void => {
            currentHost = next;
            activeGroup.fire(undefined as never);
        },
    };
}

function render(host: OverlayHostElement): TestApp {
    const app = TestApp.createWithContent(host, new Size(40, 5));
    app.render();
    return app;
}

describe("DebugToolbar on fakes", () => {
    it("a group the view layer does not know gets no toolbar; the next known one does", () => {
        const { attach } = setup(
            [{ group: "navigation", entries: [{ label: "Go", id: "go", icon: "▶", enabled: true }] }],
            null,
        );

        const host = new OverlayHostElement();
        attach(host);
        expect(render(host).backend.screenToString()).toContain("▶ Go");
    });

    it("an item without an icon color keeps the toolbar's text color on its glyph", () => {
        const host = new OverlayHostElement();
        setup(
            [
                {
                    group: "navigation",
                    entries: [
                        { label: "Plain", id: "plain", icon: "*", enabled: true },
                        { label: "Red", id: "red", icon: "!", enabled: true, iconColor: "editorError.foreground" },
                    ],
                },
            ],
            host,
        );

        const app = render(host);
        const lines = app.backend.screenToString().split("\n");
        const y = lines.findIndex((line) => line.includes("* Plain"));
        const plain = new Point(lines[y].indexOf("* Plain"), y);
        const red = new Point(lines[y].indexOf("! Red"), y);
        expect(app.backend.getFgAt(plain)).toBe(app.backend.getFgAt(new Point(plain.x + 2, y)));
        expect(app.backend.getFgAt(red)).not.toBe(app.backend.getFgAt(new Point(red.x + 2, y)));
    });

    it("a menu without buttons leaves an empty box", () => {
        const host = new OverlayHostElement();
        setup([{ group: "1_other", entries: [{ label: "Elsewhere", id: "x", enabled: true }] }], host);

        const screen = render(host).backend.screenToString();
        expect(screen).toContain("╭──╮");
        expect(screen).not.toContain("Elsewhere");
    });

    it("initializing: shown, unless the session being started suppresses the toolbar", () => {
        const go: IMenuEntryGroup[] = [
            { group: "navigation", entries: [{ label: "Go", id: "go", icon: "▶", enabled: true }] },
        ];
        const shown = new OverlayHostElement();
        setup(go, shown, { state: State.Initializing, initializingOptions: {} });
        expect(render(shown).backend.screenToString()).toContain("▶ Go");

        const suppressed = new OverlayHostElement();
        setup(go, suppressed, { state: State.Initializing, initializingOptions: { suppressDebugToolbar: true } });
        expect(render(suppressed).backend.screenToString()).not.toContain("Go");
    });
});
