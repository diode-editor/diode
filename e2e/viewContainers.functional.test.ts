import { beforeAll, describe, expect, it } from "vitest";

import { explorerTitle } from "./helpers/explorerTitle.ts";
import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";


const FILES = {
    "alpha.ts": "export const a = 1;\n",
    "beta.ts": "export const b = 2;\n",
} as const;

const KEYS = [
    { key: "f6", command: "workbench.view.search" },
    { key: "f7", command: "workbench.view.explorer" },
    // The real key is Ctrl+J, which the e2e DSL can't encode.
    { key: "f8", command: "workbench.action.togglePanel" },
];

const PROBLEMS_CONTAINER = "workbench.panel.markers.view";

async function openApp(): Promise<HeadlessApp> {
    const app = await useHeadlessApp({ files: FILES, keybindings: KEYS, cols: 100, rows: 30 });
    await app.session.waitForText((t) => t.includes(explorerTitle(app.env.workspaceDir)));
    return app;
}

async function paneIds(app: HeadlessApp, containerId: string): Promise<string[]> {
    const node = await app.session.node(`#viewContainer-${containerId.replaceAll(".", "-")}`);
    const state = node?.state as { panes?: { id: string }[] } | undefined;
    return (state?.panes ?? []).map((p) => p.id);
}

describe("View containers (functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("Explorer is a sidebar container with one section, headers merged", async () => {
        const app = await openApp();
        const { session } = app;

        // The container root is the stable selector of the location.
        expect(await session.node("#explorer")).not.toBeNull();
        expect(await paneIds(app, "explorer")).toEqual(["workbench.explorer.fileView"]);

        // A single section → the container has no header of its own; the section carries
        // its title and doesn't collapse.
        expect(await session.node("#viewContainerHeader-explorer")).toBeNull();
        const header = await session.node("#paneHeader-workbench-explorer-fileView");
        // The single section is named after the folder (#898): the isolated workspace is `workspace`.
        expect(header?.state).toMatchObject({ title: "WORKSPACE", collapsible: false });
    });

    it("the Explorer header carries the create and refresh buttons", async () => {
        const app = await openApp();
        const { session } = app;
        const header = await session.node("#paneHeader-workbench-explorer-fileView");
        expect(header).not.toBeNull();

        // The buttons occupy the right columns of the header row: three actions of 3 columns each
        // plus "⋯". Checked via the frame: the header row isn't empty on the right.
        const text = frameToText(await session.captureFrame());
        const title = explorerTitle(app.env.workspaceDir);
        const titleRow = text.split("\n").find((line) => line.includes(title))!;
        expect(titleRow.trimEnd().length).toBeGreaterThan(` ${title}`.length);
    });

    // ViewsService resolves header buttons only for the visible container; a hidden one
    // computes them when shown (OpenPerformance, lever 8). The show command right after
    // startup (the first key the inspector accepts) arrives before the `eventually` phase:
    // the header must already come with the button.
    it("a container shown right after startup comes with its header buttons", async () => {
        const app = await useHeadlessApp({ files: FILES, keybindings: KEYS, cols: 100, rows: 30 });
        const { session } = app;

        await session.key("F6");
        await session.waitForText((t) => t.includes("SEARCH"));
        const header = await session.node("#paneHeader-workbench-search-results");
        expect(header).not.toBeNull();
        const { x, y, width } = header!.box;
        const row = frameToText(await session.captureFrame()).split("\n")[y].slice(x, x + width);
        // Collapse All (`\ueac5`) is the inline button of Search's navigation group.
        expect(row).toContain("SEARCH");
        expect(row).toContain("\ueac5");
    });

    it("Search is also a single-section container, moving it does not break the root", async () => {
        const app = await openApp();
        const { session } = app;

        await session.key("F6");
        await session.waitForText((t) => t.includes("SEARCH"));
        expect(await paneIds(app, "search")).toEqual(["workbench.search.results"]);
        expect(await session.node("#searchView")).not.toBeNull();

        await session.key("F7");
        await session.waitForText((t) => t.includes(explorerTitle(app.env.workspaceDir)));
        expect(await session.node("#explorer")).not.toBeNull();
    });

    it("a bottom panel tab is a container of the same registry, without its own header", async () => {
        const app = await openApp();
        const { session } = app;

        // The panel mounts only when visible, so show it first.
        await session.key("F8");
        await session.waitForText((t) => t.includes("PROBLEMS") && t.includes("TERMINAL"));

        // The PROBLEMS tab is a container with a single section; its header is hidden,
        // the tab plays the header's role.
        expect(await paneIds(app, PROBLEMS_CONTAINER)).toEqual([PROBLEMS_CONTAINER]);

        // The empty state is drawn by the section itself, not the tab strip; the section has
        // no header row, so the hint is the first content line of the tab.
        const placeholder = await session.node("#viewPlaceholder-workbench-panel-markers-view");
        const tabs = await session.node("#panel");
        expect(placeholder).not.toBeNull();
        expect(placeholder!.box.y).toBe(tabs!.box.y + 2);
    });
});
