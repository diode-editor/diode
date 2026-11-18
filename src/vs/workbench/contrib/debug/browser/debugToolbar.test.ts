// DebugToolbar on fakes: the rules of when it shows and what it shows, its listeners, and what the workbench never
// hands it — a group without an overlay host, a menu without buttons, an item without an icon color (as an
// extension's would be).

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { OverlayHostElement } from "@tuidom/elements/contextview/overlayHostElement";
import { SelectBoxElement } from "@tuidom/elements/selectbox/selectBoxElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { Emitter } from "../../../../base/common/event.ts";
import type { IMenuEntryGroup, ResolvedMenuEntry } from "../../../../platform/actions/common/menuRegistry.ts";
import { GroupCornerStack } from "../../../browser/parts/editor/groupCornerStack.ts";
import { State } from "../common/debug.ts";

import { FOCUS_SESSION_ID } from "./debugCommands.ts";
import { DebugToolbar } from "./debugToolbar.ts";

const GO: ResolvedMenuEntry = { label: "Go", id: "go", icon: "▶", enabled: true };

interface IFakes {
    state: State;
    initializingOptions?: { suppressDebugToolbar?: boolean };
    sessions: { suppressDebugToolbar: boolean }[];
    groups: IMenuEntryGroup[];
    host: OverlayHostElement | null;
}

function setup(initial: Partial<IFakes> = {}) {
    const fakes: IFakes = {
        state: State.Stopped,
        sessions: [{ suppressDebugToolbar: false }],
        groups: [{ group: "navigation", entries: [GO] }],
        host: new OverlayHostElement(),
        ...initial,
    };
    const activeGroup = new Emitter<never>();
    const contextKeys = new Emitter<ReadonlySet<string>>();
    const icons = new Emitter<void>();
    const menu = new Emitter<void>();
    const corners = new GroupCornerStack();
    const configuration = createTestConfigurationService();
    const select = new SelectBoxElement();
    const selectChanged = new Emitter<void>();
    const toolbar = new DebugToolbar(
        {
            get state() {
                return fakes.state;
            },
            getModel: () => ({ getSessions: () => fakes.sessions }) as never,
            get initializingOptions() {
                return fakes.initializingOptions;
            },
        },
        { groupOverlayHost: () => fakes.host },
        corners,
        { activeGroup: { id: 1 } as never, onDidActiveGroupChange: activeGroup.event },
        {
            getEntryGroups: () => fakes.groups,
            createMenu: () => ({ onDidChange: menu.event, dispose: () => undefined }) as never,
        },
        { onDidChange: contextKeys.event },
        configuration,
        { onDidChange: icons.event },
        { element: select, onDidChange: selectChanged.event },
    );
    return {
        fakes,
        toolbar,
        corners,
        configuration,
        activeGroupChanged: () => {
            activeGroup.fire(undefined as never);
        },
        contextKeysChanged: () => {
            contextKeys.fire(new Set());
        },
        iconsChanged: () => {
            icons.fire();
        },
        menuChanged: () => {
            menu.fire();
        },
        /** The select's options change (a session started, ended or renamed) and it says so. */
        setSessions: (names: readonly string[]) => {
            select.setOptions(
                names.map((text) => ({ text })),
                0,
            );
            selectChanged.fire();
        },
    };
}

/** Two frames: the dock reports the group's width after the first, and the toolbar picks its labels by it. */
async function frame(host: OverlayHostElement | null, width = 40): Promise<TestApp> {
    if (host === null) throw new Error("no host");
    const app = TestApp.createWithContent(host, new Size(width, 5));
    app.render();
    await Promise.resolve();
    app.render();
    return app;
}

async function screen(host: OverlayHostElement | null, width = 40): Promise<string> {
    return (await frame(host, width)).backend.screenToString();
}

describe("DebugToolbar on fakes", () => {
    it("a stopped session shows the toolbar in the corner of the group (#debugToolbar), the next row free for find", async () => {
        const { fakes, corners } = setup();

        expect(await screen(fakes.host)).toContain("▶ Go");
        expect(fakes.host?.querySelector("#debugToolbar")).not.toBeNull();
        expect(corners.topOf(1, 1)).toBe(4);
    });

    it("hidden while inactive, even with sessions that would show it", async () => {
        const { fakes } = setup({ state: State.Inactive });

        expect(await screen(fakes.host)).not.toContain("Go");
    });

    it("hidden only while every session suppresses it", async () => {
        const some = setup({ sessions: [{ suppressDebugToolbar: true }, { suppressDebugToolbar: false }] });
        expect(await screen(some.fakes.host)).toContain("▶ Go");

        const all = setup({ sessions: [{ suppressDebugToolbar: true }] });
        expect(await screen(all.fakes.host)).not.toContain("Go");
    });

    it("initializing: shown, unless the session being started suppresses the toolbar", async () => {
        const shown = setup({ state: State.Initializing, initializingOptions: {} });
        expect(await screen(shown.fakes.host)).toContain("▶ Go");

        const suppressed = setup({ state: State.Initializing, initializingOptions: { suppressDebugToolbar: true } });
        expect(await screen(suppressed.fakes.host)).not.toContain("Go");

        // Those options are of the start in progress: a session already stopped shows the toolbar.
        const started = setup({ state: State.Stopped, initializingOptions: { suppressDebugToolbar: true } });
        expect(await screen(started.fakes.host)).toContain("▶ Go");
    });

    it("debug.toolBarLocation hidden takes it away at once, floating brings it back", async () => {
        const { fakes, configuration } = setup();

        await configuration.updateValue("debug.toolBarLocation", "hidden");
        expect(await screen(fakes.host)).not.toContain("Go");
        await configuration.updateValue("debug.toolBarLocation", "floating");
        expect(await screen(fakes.host)).toContain("▶ Go");
    });

    it("re-resolves on a context key change, a menu change and a glyph set change", async () => {
        const { fakes, contextKeysChanged, menuChanged, iconsChanged } = setup();

        fakes.groups = [{ group: "navigation", entries: [{ ...GO, label: "Keys" }] }];
        contextKeysChanged();
        expect(await screen(fakes.host)).toContain("▶ Keys");

        fakes.groups = [{ group: "navigation", entries: [{ ...GO, label: "Menu" }] }];
        menuChanged();
        expect(await screen(fakes.host)).toContain("▶ Menu");

        fakes.groups = [{ group: "navigation", entries: [{ ...GO, icon: "→" }] }];
        iconsChanged();
        expect(await screen(fakes.host)).toContain("→ Go");
    });

    it("the select of sessions growing (a session renamed) widens the toolbar to its new name", async () => {
        const focus: ResolvedMenuEntry = { label: "Focus Session", id: FOCUS_SESSION_ID, icon: "≡", enabled: true };
        const { fakes, setSessions } = setup({ groups: [{ group: "navigation", entries: [GO, focus] }] });
        setSessions(["app"]);
        expect(await screen(fakes.host)).toContain("app");

        setSessions(["application server"]);
        expect(await screen(fakes.host)).toContain("application server");
    });

    it("dispose takes the toolbar away and gives the corner back", async () => {
        const { fakes, toolbar, corners } = setup();
        await screen(fakes.host);

        toolbar.dispose();
        expect(await screen(fakes.host)).not.toContain("Go");
        expect(corners.topOf(1, 1)).toBe(1);
    });

    it("a group the view layer does not know gets no toolbar; the next known one does", async () => {
        const { fakes, activeGroupChanged } = setup({ host: null });

        fakes.host = new OverlayHostElement();
        activeGroupChanged();
        expect(await screen(fakes.host)).toContain("▶ Go");
    });

    it("labels while the toolbar and a column of margin fit in the group, glyphs only below that", async () => {
        // `▶ Go` + the box and its padding: 8 columns, and the margin.
        const fits = setup();
        expect(await screen(fits.fakes.host, 9)).toContain("▶ Go");

        const narrow = setup();
        const shown = await screen(narrow.fakes.host, 8);
        expect(shown).toContain("▶");
        expect(shown).not.toContain("Go");
    });

    it("only icon items of the navigation group become buttons", async () => {
        const { fakes } = setup({
            groups: [
                { group: "1_other", entries: [{ label: "Elsewhere", id: "x", icon: "*", enabled: true }] },
                { group: "navigation", entries: [GO, { label: "Plain", id: "plain", enabled: true }] },
            ],
        });

        const shown = await screen(fakes.host);
        expect(shown).toContain("▶ Go");
        expect(shown).not.toContain("Elsewhere");
        expect(shown).not.toContain("Plain");
    });

    it("a menu without buttons leaves an empty box", async () => {
        const { fakes } = setup({
            groups: [{ group: "1_other", entries: [{ label: "Elsewhere", id: "x", enabled: true }] }],
        });

        expect(await screen(fakes.host)).toContain("╭──╮");
    });

    it("an item without an icon color keeps the label's color on its glyph", async () => {
        const { fakes } = setup({
            groups: [
                {
                    group: "navigation",
                    entries: [
                        { label: "Plain", id: "plain", icon: "*", enabled: true },
                        { label: "Red", id: "red", icon: "!", enabled: true, iconColor: "editorError.foreground" },
                    ],
                },
            ],
        });
        const app = await frame(fakes.host);

        const lines = app.backend.screenToString().split("\n");
        const y = lines.findIndex((line) => line.includes("* Plain"));
        const plain = new Point(lines[y].indexOf("* Plain"), y);
        const red = new Point(lines[y].indexOf("! Red"), y);
        expect(app.backend.getFgAt(plain)).toBe(app.backend.getFgAt(new Point(plain.x + 2, y)));
        expect(app.backend.getFgAt(red)).not.toBe(app.backend.getFgAt(new Point(red.x + 2, y)));
    });
});
