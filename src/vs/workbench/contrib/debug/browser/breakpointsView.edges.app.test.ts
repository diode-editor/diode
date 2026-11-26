// BREAKPOINTS on the edges, as the user meets them: the exception filters toggled from the keyboard, the
// presentation changed in the settings, a breakpoint in a file that is gone, a long file name in a narrow
// sidebar, and Delete pressed again and again.

import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { BREAKPOINTS_VIEW_ID, type IBreakpointData } from "../common/debug.ts";
import type { DebugModel } from "../common/debugModel.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { type DebugViewletComponent, DebugViewletComponentDIToken } from "./debugViewlet.ts";

const repoRoot = process.cwd();
const sample = Uri.file(resolve(repoRoot, "e2e", "fixtures", "sample.ts"));

describe("BREAKPOINTS on the edges", () => {
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        t = await createDebugViewletHarness(repoRoot);
        const views = t.h.container.get(ViewsServiceDIToken);
        for (const id of views.getContainerViews("workbench.view.debug").map((v) => v.id)) {
            if (id !== BREAKPOINTS_VIEW_ID) views.setViewVisible(id, false);
        }
    });

    afterEach(async () => {
        await t.dispose();
    });

    function model(): DebugModel {
        return t.h.container.get(DebugServiceDIToken).getModel() as DebugModel;
    }

    async function addBreakpoints(uri: Uri, data: IBreakpointData[]): Promise<void> {
        model().addBreakpoints(uri, data);
        await t.h.container.get(DebugServiceDIToken).sendBreakpoints(uri);
    }

    function tree(): DebugViewletComponent["breakpoints"]["tree"] {
        return t.h.container.get(DebugViewletComponentDIToken).breakpoints.tree;
    }

    it("Space on an exception filter row toggles the filter, as a click on its checkbox does", async () => {
        await t.startStopped();
        await vi.waitFor(() => {
            expect(t.screen()).toContain("[ ] C++: on throw");
        });
        tree().list.focus();
        tree().list.focusFirst();

        t.h.testApp.sendKey(" ");

        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] C++: on throw");
        });
        expect(
            model()
                .getExceptionBreakpoints()
                .find((e) => e.filter === "cpp_throw")?.enabled,
        ).toBe(true);
    });

    it("debug.breakpointsView.presentation set in the settings switches the view to the tree", async () => {
        await addBreakpoints(sample, [{ lineNumber: 3 }]);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] ● sample.ts");
        });

        await t.h.container.get(IConfigurationServiceDIToken).updateValue("debug.breakpointsView.presentation", "tree");

        await vi.waitFor(() => {
            expect(t.screen()).toContain("const answer = 42;");
        });
    });

    it("the tree presentation with a breakpoint in a file that is gone still shows the breakpoint", async () => {
        const gone = Uri.file(resolve(repoRoot, "e2e", "fixtures", "no-such-file.ts"));
        await addBreakpoints(gone, [{ lineNumber: 7 }]);
        await addBreakpoints(sample, [{ lineNumber: 999 }]);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("no-such-file.ts");
        });

        await t.h.commands.execute("workbench.debug.viewlet.action.toggleBreakpointsPresentation");

        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] no-such-file.ts");
        });
        await vi.waitFor(() => {
            const rows = t.lines();
            const file = rows.findIndex((r) => r.includes("no-such-file.ts"));
            expect(rows[file + 1]).toContain("●");
        });
        expect(t.screen()).toContain("[✓] sample.ts");
    });

    it("a long file name in a narrow sidebar is cut, the line number on the right stays", async () => {
        const long = Uri.file(resolve(repoRoot, "e2e", "fixtures", `${"a".repeat(80)}.ts`));
        await addBreakpoints(long, [{ lineNumber: 1234 }]);

        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] ● aaaa");
        });
        const row = t.lines()[t.find("[✓] ● aaaa").y];
        expect(row).toContain("1234");
    });

    it("Delete again and again removes the rows one by one, from the keyboard alone", async () => {
        await addBreakpoints(sample, [{ lineNumber: 2 }, { lineNumber: 3 }, { lineNumber: 4 }]);
        await t.h.container.get(DebugServiceDIToken).addFunctionBreakpoint({ name: "main" });
        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] ▲ main");
        });
        tree().list.focus();
        tree().list.focusFirst();

        for (let left = 3; left >= 0; left--) {
            t.h.testApp.sendKey("Delete");
            await vi.waitFor(() => {
                expect(model().getBreakpoints().length + model().getFunctionBreakpoints().length).toBe(left);
            });
            // The rows follow the model a moment later; the next Delete acts on the row under the cursor then.
            await vi.waitFor(() => {
                expect(t.lines().filter((row) => row.includes("[✓]"))).toHaveLength(left);
            });
        }
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("[✓]");
        });
    });
});
