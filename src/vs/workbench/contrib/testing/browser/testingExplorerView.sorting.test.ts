import { describe, expect, it, vi } from "vitest";

import { add, setupExplorer, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { TestItemExpandState } from "../../../api/common/testingWireTypes.ts";

// Upstream's TreeSorter falls back to `compareFileNames` (a numeric collator): `test 2` comes before `test 10`.

const { NotExpandable, Expanded } = TestItemExpandState;

describe("Test Explorer — sorting by label", () => {
    it("tests without a location are in natural order: test 2 before test 10", async () => {
        const explorer = setupExplorer({ height: 14 });
        explorer.registerController("ctrl", "Ctrl");
        const labels = ["test 1", "test 10", "test 2", "test 9"];
        explorer.tests.publishDiff([
            add(wireItem(["ctrl"], "Ctrl"), Expanded),
            add(wireItem(["ctrl", "group"], "group"), Expanded),
            ...labels.map((label) => add(wireItem(["ctrl", "group", label], label), NotExpandable)),
        ]);
        await explorer.waitFrame((text) => text.includes(" group"));
        const { x, y } = explorer.row("group");
        explorer.click(x, y);
        await explorer.waitFrame((text) => text.includes("test 10"));
        const order = (): string[] =>
            explorer
                .lines()
                .map((line) => /\b(test \d+)\b/.exec(line)?.[1])
                .filter((label): label is string => label !== undefined);
        await vi.waitFor(() => {
            expect(order()).toEqual(["test 1", "test 2", "test 9", "test 10"]);
        });
    });
});
