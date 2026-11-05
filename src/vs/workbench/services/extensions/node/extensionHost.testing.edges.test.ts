import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { testId, testTree } from "../../../../../TestUtils/testTree.ts";
import { settle, waitUntil } from "../../../../../TestUtils/timing.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ExtensionTestingAdapter } from "../../../contrib/testing/browser/extensionTestingAdapter.ts";
import { TestProfileService } from "../../../contrib/testing/common/testProfileService.ts";
import { TestService } from "../../../contrib/testing/common/testService.ts";

// Edge cases of the Test API wiring, driven by a probe extension that runs script bodies on request.
describe("ExtensionHost — test controllers, edge cases", () => {
    let harness: IExtensionHarness;
    let contextKeys: ContextKeyService;
    let tests: TestService;
    let profiles: TestProfileService;
    const output: string[] = [];

    beforeEach(async () => {
        output.length = 0;
        contextKeys = new ContextKeyService();
        tests = new TestService(contextKeys);
        profiles = new TestProfileService(contextKeys);
        harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.probe", "testingProbeExtension.cjs")],
            testingSink: new ExtensionTestingAdapter(tests, profiles),
            outputSink: {
                append: (channel, _label, level, value) => {
                    output.push(`${channel}/${level}: ${value}`);
                },
                show: () => undefined,
            },
        });
    });

    afterEach(async () => {
        await harness.dispose();
    });

    const run = async (source: string): Promise<{ ok?: unknown; error?: string }> =>
        (await harness.commandRegistry.execute("test.probe.run", source)) as { ok?: unknown; error?: string };
    const events = async (): Promise<string[]> =>
        (await harness.commandRegistry.execute("test.probe.events")) as string[];
    const waitForEvent = async (event: string): Promise<void> => {
        await waitUntil(`the extension saw "${event}"`, async () => (await events()).includes(event));
    };

    it("[api:tests.createTestController] a duplicate controller id throws in the extension, as upstream", async () => {
        await run(`state.a = vscode.tests.createTestController("dup", "A");`);
        const second = await run(`state.b = vscode.tests.createTestController("dup", "B");`);
        expect(second.error).toContain('Attempt to insert a duplicate controller with ID "dup"');
        await waitUntil("the controller", () => tests.rootItems.length === 1);
        expect(tests.getTestController("dup")?.label).toBe("A");
    });

    it("[api:tests.createTestController] a test id with the delimiter is refused, as upstream", async () => {
        await run(`state.c = vscode.tests.createTestController("c", "C");`);
        const created = await run(`state.c.createTestItem("a\\0b", "bad");`);
        expect(created.error).toContain("Test IDs may not include");
    });

    it("[api:tests.createTestController] disposing one of two controllers keeps the other", async () => {
        await run(`
            state.a = vscode.tests.createTestController("a", "A");
            state.a.refreshHandler = () => {};
            state.b = vscode.tests.createTestController("b", "B");
            state.b.items.add(state.b.createTestItem("x", "x"));
        `);
        await waitUntil("two controllers", () => contextKeys.get("testing.providerCount") === 2);
        await waitUntil("the item", () => tests.getNodeById(testId("b", "x")) !== undefined);
        expect(testTree(tests, false)).toEqual(["A", "B", "  x"]);
        await run(`state.a.dispose();`);
        await waitUntil("one controller", () => contextKeys.get("testing.providerCount") === 1);
        expect(testTree(tests, false)).toEqual(["B", "  x"]);
        expect(contextKeys.get("testing.canRefresh")).toBe(false);
    });

    it("[api:tests.createTestController] disposing a controller right after another adds items keeps the other's tree", async () => {
        await run(`
            state.a = vscode.tests.createTestController("a", "A");
            state.b = vscode.tests.createTestController("b", "B");
            state.b.items.add(state.b.createTestItem("x", "x"));
            state.a.dispose();
        `);
        await waitUntil("the item", () => tests.getNodeById(testId("b", "x")) !== undefined);
        expect(testTree(tests, false)).toEqual(["B", "  x"]);
    });

    it("[api:tests.createTestController] assigning and clearing refreshHandler later toggles testing.canRefresh", async () => {
        await run(`state.c = vscode.tests.createTestController("c", "C");`);
        await waitUntil("the controller", () => contextKeys.get("testing.providerCount") === 1);
        expect(contextKeys.get("testing.canRefresh")).toBe(false);
        await run(`state.c.refreshHandler = () => {};`);
        await waitUntil("canRefresh on", () => contextKeys.get("testing.canRefresh") === true);
        await run(`state.c.refreshHandler = undefined;`);
        await waitUntil("canRefresh off", () => contextKeys.get("testing.canRefresh") === false);
    });

    it("[api:tests.createTestController] a refresh calls every controller with a handler; a throwing one rejects it and the host lives", async () => {
        await run(`
            for (const id of ["a", "b"]) {
                const c = vscode.tests.createTestController(id, id);
                c.refreshHandler = async () => { events.push("refresh:" + id); if (id === "a") throw new Error("boom"); };
                state[id] = c;
            }
            state.n = vscode.tests.createTestController("n", "n");
        `);
        await waitUntil("three controllers", () => contextKeys.get("testing.providerCount") === 3);
        // As upstream, the handler's error rejects the refresh; the other controller still refreshed.
        await expect(tests.refreshTests()).rejects.toThrow("boom");
        expect(contextKeys.get("testing.isRefreshing")).toBe(false);
        expect((await events()).sort()).toEqual(["refresh:a", "refresh:b"]);
        // The host still answers.
        expect((await run(`return 1 + 1;`)).ok).toBe(2);
    });

    it("[api:tests.createTestController] a resolveHandler assigned after the items makes them expandable", async () => {
        await run(`
            const c = vscode.tests.createTestController("c", "C");
            const f = c.createTestItem("f", "f");
            f.canResolveChildren = true;
            c.items.add(f);
            state.c = c;
        `);
        await waitUntil("the file", () => tests.getNodeById(testId("c", "f")) !== undefined);
        expect(tests.getNodeById(testId("c", "f"))?.expand).toBe(0);
        await run(`state.c.resolveHandler = (item) => { events.push("resolve:" + (item ? item.id : "<root>")); };`);
        await waitUntil("the file expandable", () => tests.getNodeById(testId("c", "f"))?.expand === 1);
        await tests.expandTest(testId("c", "f"), 1);
        expect(await events()).toEqual(["resolve:f"]);
    });

    it("[api:tests.createTestController] expanding an unknown test id is a no-op", async () => {
        await run(
            `state.c = vscode.tests.createTestController("c", "C"); state.c.resolveHandler = () => events.push("r");`,
        );
        await waitUntil("the controller", () => tests.rootItems.length === 1);
        await expect(tests.expandTest(testId("c", "nope"), 1)).resolves.toBeUndefined();
        await expect(tests.expandTest(testId("ghost", "x"), 1)).resolves.toBeUndefined();
    });

    it("[api:tests.createTestController] field edits reach the core node: description, busy, error, tags, sortText, range", async () => {
        await run(`
            const c = vscode.tests.createTestController("c", "C");
            const t = c.createTestItem("t", "тест 🧪");
            c.items.add(t);
            state.t = t;
        `);
        await waitUntil("the test", () => tests.getNodeById(testId("c", "t")) !== undefined);
        await run(`
            const t = state.t;
            t.description = "desc";
            t.busy = true;
            t.error = new vscode.MarkdownString("**bad**");
            t.tags = [new vscode.TestTag("slow")];
            t.sortText = "z";
            t.range = new vscode.Range(2, 0, 4, 1);
        `);
        await waitUntil("the edits", () => tests.getNodeById(testId("c", "t"))?.item.sortText === "z");
        expect(tests.getNodeById(testId("c", "t"))?.item).toMatchObject({
            label: "тест 🧪",
            description: "desc",
            busy: true,
            error: "**bad**",
            tags: ["c\0slow"],
            sortText: "z",
            range: { start: { line: 2, character: 0 }, end: { line: 4, character: 1 } },
        });
    });

    it("[api:tests.createTestController] an item added under another parent moves there", async () => {
        await run(`
            const c = vscode.tests.createTestController("c", "C");
            const a = c.createTestItem("a", "a");
            const b = c.createTestItem("b", "b");
            const t = c.createTestItem("t", "t");
            a.children.add(t);
            c.items.replace([a, b]);
            Object.assign(state, { c, a, b, t });
        `);
        await waitUntil("the tree", () => tests.getNodeById(testId("c", "a", "t")) !== undefined);
        await run(`state.a.children.delete("t"); state.b.children.add(state.t);`);
        await waitUntil("the move", () => tests.getNodeById(testId("c", "b", "t")) !== undefined);
        expect(testTree(tests, false)).toEqual(["C", "  a", "  b", "    t"]);
    });

    it("[api:tests.createTestController] two thousand tests in one go all arrive", async () => {
        await run(`
            const c = vscode.tests.createTestController("c", "C");
            const f = c.createTestItem("f", "f");
            const kids = [];
            for (let i = 0; i < 2000; i++) kids.push(c.createTestItem("t" + i, "t" + i));
            f.children.replace(kids);
            c.items.add(f);
        `);
        await waitUntil("all tests", () => (tests.getNodeById(testId("c", "f"))?.children.size ?? 0) === 2000);
        expect(tests.getNodeById(testId("c", "f", "t1999"))?.item.label).toBe("t1999");
    });

    it("[api:tests.createTestController] profiles: Debug alone is not runnable; edits mirror; same-label profiles both arrive", async () => {
        await run(`
            const c = vscode.tests.createTestController("c", "C");
            state.d = c.createRunProfile("Debug", vscode.TestRunProfileKind.Debug, () => {});
            state.c = c;
        `);
        await waitUntil("the debug profile", () => profiles.getControllerProfiles("c").length === 1);
        expect(contextKeys.get("testing.hasRunnableTests")).toBe(false);
        await run(`
            state.r1 = state.c.createRunProfile("Run", vscode.TestRunProfileKind.Run, () => {});
            state.r2 = state.c.createRunProfile("Run", vscode.TestRunProfileKind.Run, () => {});
        `);
        await waitUntil("three profiles", () => profiles.getControllerProfiles("c").length === 3);
        expect(contextKeys.get("testing.hasRunnableTests")).toBe(true);
        await run(`
            state.r1.label = "Run fast";
            state.r1.isDefault = true;
            state.r1.tag = new vscode.TestTag("unit");
        `);
        await waitUntil("the edits", () => profiles.getControllerProfiles("c").some((p) => p.label === "Run fast"));
        expect(profiles.getControllerProfiles("c").find((p) => p.label === "Run fast")).toMatchObject({
            isDefault: true,
            tag: "c\0unit",
        });
        await run(`state.r1.dispose();`);
        await waitUntil("two profiles", () => profiles.getControllerProfiles("c").length === 2);
        expect(contextKeys.get("testing.hasRunnableTests")).toBe(true);
        await run(`state.r2.dispose();`);
        await waitUntil("not runnable", () => contextKeys.get("testing.hasRunnableTests") === false);
    });

    it("[api:tests.createTestController] the subprocess dying during a refresh ends testing.isRefreshing", async () => {
        await run(`
            const c = vscode.tests.createTestController("c", "C");
            c.refreshHandler = () => { events.push("refresh"); return new Promise(() => {}); };
        `);
        await waitUntil("canRefresh", () => contextKeys.get("testing.canRefresh") === true);
        const refreshing = tests.refreshTests().then(
            () => "resolved",
            (error: unknown) => String(error),
        );
        await waitForEvent("refresh");
        await harness.commandRegistry.execute("test.probe.kill");
        await waitUntil("the reset", () => contextKeys.get("testing.providerCount") === 0);
        expect(await Promise.race([refreshing, settle(2000).then(() => "pending")])).not.toBe("pending");
        expect(contextKeys.get("testing.isRefreshing")).toBe(false);
    });
});
