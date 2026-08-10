import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

// Тест ПРОДЮСЕРА `editor.layoutChanged` + `editor.showTextDocument` (правило
// AGENTS: на каждое новое RPC-сообщение — тест продюсера): настоящая полоса
// групп + настоящий subprocess. Фикстура tabGroupsWatcher.cjs записывает, что
// реально доехало до расширения через window.tabGroups.

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
            // Стартовый снимок уже нёс полосу с main.ts (layoutChanged до активации).
            const initial = await snapshot(harness);
            expect(initial.groups.length).toBe(1);
            expect(initial.groups[0].tabs.map((tab) => tab.label)).toEqual(["main.ts"]);
            expect(initial.groups[0].tabs[0].inputKind).toBe("text");
            expect(initial.groups[0].tabs[0].isPinned).toBe(false);
            expect(initial.visible).toBe(1);

            // Сплит: вторая группа с дублем вкладки.
            harness.group.splitActiveGroup();
            await settle();
            const afterSplit = await snapshot(harness);
            expect(afterSplit.groups.length).toBe(2);
            expect(afterSplit.groups.map((group) => group.viewColumn)).toEqual([1, 2]);
            expect(afterSplit.groups[1].isActive).toBe(true);
            expect(afterSplit.visible).toBe(2);

            const log = await dump(harness);
            // Событие групп: opened с колонкой 2.
            expect(
                log.some((entry) => entry.kind === "groups" && (entry.opened ?? []).includes(2)),
            ).toBe(true);
            // Событие видимых редакторов дошло.
            expect(log.some((entry) => entry.kind === "visible" && entry.count === 2)).toBe(true);
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

            // Beside (-2): открывается в новой группе 2; результат несёт колонку.
            const beside = (await harness.commandRegistry.execute("test.tabs.show", {
                uri,
                viewColumn: -2,
            })) as { uri: string; viewColumn: number };
            expect(beside.viewColumn).toBe(2);
            expect(harness.group.groups.length).toBe(2);

            // Повторный показ в ту же колонку — дедуп, группа не растёт.
            await harness.commandRegistry.execute("test.tabs.show", { uri, viewColumn: 2 });
            expect(harness.group.groups[1].editorCount).toBe(1);

            // preserveFocus: активная группа не меняется.
            harness.group.focusGroup({ index: 0 });
            await settle();
            await harness.commandRegistry.execute("test.tabs.show", {
                uri,
                viewColumn: 2,
                preserveFocus: true,
            });
            expect(harness.group.viewColumnOf(harness.group.activeGroup)).toBe(1);
        } finally {
            await harness.dispose();
        }
    });
});
