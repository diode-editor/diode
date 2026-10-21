import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

interface ITabsDumpEntry {
    kind: "activate" | "tabs" | "groups" | "visible";
    opened?: (string | number)[];
    closed?: (string | number)[];
    changed?: (string | number)[];
    count?: number;
    groups?: unknown[];
    visible?: number;
}

interface ITabsSnapshot {
    groups: {
        viewColumn: number;
        isActive: boolean;
        tabs: {
            label: string;
            isActive: boolean;
            isDirty: boolean;
            isPinned: boolean;
            isPreview: boolean;
            inputKind: string;
            uri: string | null;
        }[];
    }[];
    visible: number;
}

async function dump(harness: IExtensionHarness): Promise<ITabsDumpEntry[]> {
    return (await harness.commandRegistry.execute("test.tabs.dump")) as ITabsDumpEntry[];
}

async function snapshot(harness: IExtensionHarness): Promise<ITabsSnapshot> {
    return (await harness.commandRegistry.execute("test.tabs.snapshot")) as ITabsSnapshot;
}

describe("ExtensionHost — tabGroups/layout producer (subprocess)", () => {
    it("AS-12/14/15: сплит и открытие вкладок доезжают событиями tabGroups", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const a = 1;\n" },
            extensions: [extensionFixture("test.tabs", "tabGroupsWatcher.cjs")],
        });
        try {
            await settle();
            // The initial snapshot already carried the strip with main.ts (layoutChanged before activation).
            const initial = await snapshot(harness);
            expect(initial.groups.length).toBe(1);
            expect(initial.groups[0].tabs.map((tab) => tab.label)).toEqual(["main.ts"]);
            expect(initial.groups[0].tabs[0].inputKind).toBe("text");
            expect(initial.groups[0].tabs[0].isPinned).toBe(false);
            expect(initial.visible).toBe(1);

            harness.group.splitActiveGroup();
            await settle();
            const afterSplit = await snapshot(harness);
            expect(afterSplit.groups.length).toBe(2);
            expect(afterSplit.groups.map((group) => group.viewColumn)).toEqual([1, 2]);
            expect(afterSplit.groups[1].isActive).toBe(true);
            expect(afterSplit.visible).toBe(2);

            const log = await dump(harness);
            expect(log.some((entry) => entry.kind === "groups" && (entry.opened ?? []).includes(2))).toBe(true);
            expect(log.some((entry) => entry.kind === "visible" && entry.count === 2)).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("AS-16: tabGroups.close(tab) из расширения закрывает вкладку ядра", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const a = 1;\n" },
            extensions: [extensionFixture("test.tabs", "tabGroupsWatcher.cjs")],
        });
        try {
            await settle();
            harness.group.openFile(harness.writeFile("second.ts", "const b = 2;\n"));
            await settle();
            expect(harness.group.editorGroups.activeGroup.editorCount).toBe(2);

            const result = await harness.commandRegistry.execute("test.tabs.close", { label: "second.ts" });
            await settle();

            expect(result).toBe(true);
            expect(harness.group.editorGroups.activeGroup.editorCount).toBe(1);
            // The fresh snapshot reached the extension BEFORE the response: the tab is gone from tabGroups.
            const after = await snapshot(harness);
            expect(after.groups[0].tabs.map((tab) => tab.label)).toEqual(["main.ts"]);
        } finally {
            await harness.dispose();
        }
    });

    it("AS-17: tabGroups.close(group) из расширения схлопывает группу", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const a = 1;\n" },
            extensions: [extensionFixture("test.tabs", "tabGroupsWatcher.cjs")],
        });
        try {
            await settle();
            harness.group.splitActiveGroup();
            await settle();
            expect(harness.group.editorGroups.groups.length).toBe(2);

            const result = await harness.commandRegistry.execute("test.tabs.closeGroup", { viewColumn: 2 });
            await settle();

            expect(result).toBe(true);
            expect(harness.group.editorGroups.groups.length).toBe(1);
            const after = await snapshot(harness);
            expect(after.groups.length).toBe(1);
        } finally {
            await harness.dispose();
        }
    });

    it("AS-1/2/4: showTextDocument из расширения — Beside создаёт группу, дедуп и preserveFocus работают", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const a = 1;\n" },
            extensions: [extensionFixture("test.tabs", "tabGroupsWatcher.cjs")],
        });
        try {
            await settle();
            const uri = harness.group.getActiveEditor()!.uri.toString();

            // Beside (-2): opens in a new group 2; the result carries the column.
            const beside = (await harness.commandRegistry.execute("test.tabs.show", {
                uri,
                viewColumn: -2,
            })) as { uri: string; viewColumn: number };
            expect(beside.viewColumn).toBe(2);
            expect(harness.group.editorGroups.groups.length).toBe(2);

            // Showing again in the same column is deduplicated; the group count does not grow.
            await harness.commandRegistry.execute("test.tabs.show", { uri, viewColumn: 2 });
            expect(harness.group.editorGroups.groups[1].editorCount).toBe(1);

            // preserveFocus: the active group does not change.
            harness.group.editorGroups.focusGroup({ index: 0 });
            await settle();
            await harness.commandRegistry.execute("test.tabs.show", {
                uri,
                viewColumn: 2,
                preserveFocus: true,
            });
            expect(harness.group.editorGroups.viewColumnOf(harness.group.editorGroups.activeGroup)).toBe(1);
        } finally {
            await harness.dispose();
        }
    });
});
