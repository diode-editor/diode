import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../TestUtils/timing.ts";
import { ProgressService } from "../../../platform/progress/common/progressService.ts";
import { makeViewsHarness, testView } from "../../browser/parts/views/viewsService.testUtils.ts";

import { ExtensionViewProgressAdapter } from "./extensionViewProgressAdapter.ts";

const SCM = "workbench.scm.changes";

describe("ExtensionViewProgressAdapter", () => {
    let progress: ProgressService;
    let errors: string[];
    let adapter: ExtensionViewProgressAdapter;

    const spinning = (): string[] => [...progress.viewProgress().keys()];

    beforeEach(() => {
        vi.useFakeTimers();
        const views = makeViewsHarness();
        views.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        views.service.registerView(testView(SCM, "scm", 10));
        views.service.registerContainer({ id: "probe", title: "PROBE", location: "sidebar" });
        views.service.registerView(testView("probe.first", "probe", 10));
        views.service.registerView(testView("probe.second", "probe", 20));
        views.service.registerContainer({ id: "empty", title: "EMPTY", location: "panel" });
        progress = new ProgressService({ delayMs: 0, minVisibleMs: 0, intervalMs: 100 });
        errors = [];
        adapter = new ExtensionViewProgressAdapter(
            views.service,
            progress,
            { error: (line: string) => errors.push(line) },
            SCM,
        );
    });

    afterEach(() => {
        progress.dispose();
        vi.useRealTimers();
    });

    it.each([
        ["a view id: that view", { viewId: "probe.second" }, "probe.second"],
        ["a container id: its first view", { viewId: "probe" }, "probe.first"],
        ["SourceControl: the SCM view", "sourceControl", SCM],
    ] as const)("%s spins until the end, passively", async (_name, location, viewId) => {
        adapter.start(1, location, "Indexing");
        vi.advanceTimersByTime(1);

        expect(spinning()).toEqual([viewId]);
        expect(progress.viewProgress().get(viewId)?.title).toBe("Indexing");
        expect(progress.isBusy(viewId)).toBe(false);

        adapter.end(1);
        await flushMicrotasks();
        vi.advanceTimersByTime(1);
        expect(spinning()).toEqual([]);
        expect(errors).toEqual([]);
    });

    it.each([
        ["an unknown id", "no.such.view"],
        ["a container without views", "empty"],
    ])("%s: no progress, the upstream error in the log", (_name, viewId) => {
        adapter.start(1, { viewId }, "Indexing");
        vi.advanceTimersByTime(1);

        expect(errors).toEqual([`Bad progress location: ${viewId}`]);
        expect(progress.isBusy()).toBe(false);
        expect(spinning()).toEqual([]);
        adapter.end(1);
    });

    it("ends only its own handle; an unknown one is ignored", async () => {
        adapter.start(1, { viewId: "probe.first" }, "a");
        adapter.start(2, { viewId: "probe.second" }, "b");
        adapter.end(7);
        adapter.end(1);
        await flushMicrotasks();
        vi.advanceTimersByTime(1);

        expect(spinning()).toEqual(["probe.second"]);
        adapter.end(2);
    });
});
