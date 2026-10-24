import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { getFileIcon } from "../../base/common/fileIcons.ts";
import { Uri } from "../../base/common/uri.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { MarkerServiceDIToken } from "../../platform/markers/common/markerService.ts";

const PUA = /[\uE000-\uF8FF]|[\u{F0000}-\u{10FFFF}]/gu;

/**
 * Glyphs drawn inside tuidom widgets (the tree chevrons): the follow-up task of the chain moves them
 * to the setting, they need an engine release.
 */
const TUIDOM_WIDGET_GLYPHS = new Set(["", ""]);

/** Lines with a PUA character of Diode's own: what a font without Nerd Font symbols draws as tofu. */
function puaOnScreen(screen: string): string[] {
    return screen
        .split("\n")
        .filter((line) => [...line.matchAll(PUA)].some(([char]) => !TUIDOM_WIDGET_GLYPHS.has(char)));
}

describe("diode.icons.nerdFont", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-nerd-font-",
            files: {
                "app.ts": "function main() {\n    if (true) {\n        run();\n    }\n}\n",
                "notes.md": "# Notes\n",
                Makefile: "all:\n",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        h.workbench.openFile(ws.path("app.ts"));
        await settle();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    async function settle(): Promise<void> {
        // The tree reads directories and refreshes asynchronously.
        await new Promise((resolve) => setTimeout(resolve, 30));
        h.testApp.render();
    }

    function screen(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    async function setMode(value: string): Promise<void> {
        await h.container.get(IConfigurationServiceDIToken).updateValue("diode.icons.nerdFont", value);
        await settle();
    }

    function lineWith(text: string): string {
        const line = screen()
            .split("\n")
            .find((candidate) => candidate.includes(text));
        if (line === undefined) throw new Error(`no line with "${text}" in\n${screen()}`);
        return line;
    }

    it("on by default: file icons and Nerd Font chevrons, as before", () => {
        const tsIcon = getFileIcon("app.ts").icon;
        expect(lineWith("notes.md")).toContain(`${getFileIcon("notes.md").icon} notes.md`);
        expect(screen()).toContain(`${tsIcon} app.ts`);
        expect(puaOnScreen(screen())).not.toEqual([]);
    });

    it("off: no Private Use Area character anywhere on the frame", async () => {
        await setMode("off");
        await vi.waitFor(() => {
            expect(puaOnScreen(screen())).toEqual([]);
        });
        expect(screen()).toContain("▾"); // ▾ — the expanded section chevron
    });

    it("off: a file row loses the icon column together with its gap", async () => {
        const before = lineWith("notes.md");
        await setMode("off");
        await vi.waitFor(() => {
            expect(lineWith("notes.md")).not.toContain(getFileIcon("notes.md").icon);
        });
        const after = lineWith("notes.md");
        // The icon and its space (2 columns) are gone: the name moves left instead of keeping a blank cell.
        expect(after.indexOf("notes.md")).toBe(before.indexOf("notes.md") - 2);
    });

    it("off: the editor tab has no icon either", async () => {
        await setMode("off");
        await vi.waitFor(() => {
            expect(screen()).not.toContain(getFileIcon("app.ts").icon);
        });
        expect(screen()).toContain("app.ts");
    });

    it("off: a folded region shows the Unicode chevron in the gutter", async () => {
        await setMode("off");
        h.activeEditor().goToPosition(0, 0);
        // Folding regions are computed after the open: retry the fold until there is one.
        await vi.waitFor(() => {
            h.activeEditor().foldAtCursor();
            expect(lineWith("function main()")).toContain("▸"); // ▸
        });
        expect(puaOnScreen(screen())).toEqual([]);
    });

    it("off: Problems marks severities with Unicode characters", async () => {
        const uri = Uri.file(ws.path("app.ts")).toString();
        const range = { start: { line: 2, character: 8 }, end: { line: 2, character: 11 } };
        h.container.get(MarkerServiceDIToken).changeOne("test", uri, [
            { severity: MarkerSeverity.Error, range, message: "broken call" },
            { severity: MarkerSeverity.Warning, range, message: "odd call" },
        ]);
        await h.commands.execute("workbench.actions.view.problems");
        await setMode("off");
        await vi.waitFor(() => {
            expect(lineWith("broken call")).toContain("✗"); // ✗
        });
        expect(lineWith("odd call")).toContain("⚠"); // ⚠
        expect(puaOnScreen(screen())).toEqual([]);
    });

    it("switches back to Nerd Font live, without a restart", async () => {
        await setMode("off");
        await vi.waitFor(() => {
            expect(puaOnScreen(screen())).toEqual([]);
        });
        await setMode("on");
        await vi.waitFor(() => {
            expect(lineWith("notes.md")).toContain(`${getFileIcon("notes.md").icon} notes.md`);
        });
        expect(screen()).not.toContain("▾");
    });
});
