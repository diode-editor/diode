import { describe, expect, it } from "vitest";

import { createSwitchableIcons } from "../../../../TestUtils/switchableIcons.ts";
import { CODICON_GLYPHS } from "../../../base/common/codicons.generated.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import { NULL_STATE_SERVICE } from "../../../platform/state/common/nullStateService.ts";
import type { IStatusBarEntry } from "../../services/statusbar/common/statusBarService.ts";
import { StatusBarService } from "../../services/statusbar/common/statusBarService.ts";
import type { ICommandService } from "../common/iCommandService.ts";
import type { IWireStatusBarItem } from "../common/wireTypes.ts";

import { ExtensionStatusBarAdapter, renderStatusBarItemText } from "./extensionStatusBarAdapter.ts";

function makeCommands(behaviour?: (id: string) => unknown): {
    service: ICommandService;
    calls: { id: string; args: readonly unknown[] }[];
} {
    const calls: { id: string; args: readonly unknown[] }[] = [];
    const service = {
        execute: (id: string, args: readonly unknown[]): unknown => {
            calls.push({ id, args });
            return behaviour?.(id);
        },
        holdInputUntil: () => undefined,
        listCommandIds: () => [],
        registerProxy: () => ({ dispose: () => undefined }),
    };
    return { service, calls };
}

function makeErrorLogger(): { logger: ILogger; errors: string[] } {
    const errors: string[] = [];
    const logger = {
        error: (message: string) => errors.push(message),
    } as unknown as ILogger;
    return { logger, errors };
}

function makeAdapter(behaviour?: (id: string) => unknown): {
    bar: StatusBarService;
    adapter: ExtensionStatusBarAdapter;
    calls: { id: string; args: readonly unknown[] }[];
    errors: string[];
} {
    const bar = new StatusBarService(NULL_STATE_SERVICE);
    const { service, calls } = makeCommands(behaviour);
    const { logger, errors } = makeErrorLogger();
    return { bar, adapter: new ExtensionStatusBarAdapter(bar, service, logger), calls, errors };
}

function wireItem(patch: Partial<IWireStatusBarItem> = {}): IWireStatusBarItem {
    return { handle: 1, id: "demo", alignment: "right", text: "Demo", ...patch };
}

function entry(bar: StatusBarService, id: string): IStatusBarEntry {
    const found = bar.allEntries().find((e) => e.id === id);
    if (found === undefined)
        throw new Error(
            `no entry "${id}": ${bar
                .allEntries()
                .map((e) => e.id)
                .join(", ")}`,
        );
    return found;
}

describe("ExtensionStatusBarAdapter", () => {
    it("update creates a status bar entry under its own prefix", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ name: "Status Bar Demo", priority: 100 }));

        expect(entry(bar, "extensions.demo")).toMatchObject({
            text: " Demo ".trim(),
            alignment: "right",
            priority: 100,
            name: "Status Bar Demo",
        });
    });

    it("extension id cannot collide with a built-in segment", () => {
        const { bar, adapter } = makeAdapter();
        bar.addEntry({ id: "status.editor.encoding", text: "UTF-8", alignment: "right", priority: 30 });
        adapter.update(wireItem({ id: "status.editor.encoding", text: "HA" }));

        expect(bar.entries().map((e) => e.id)).toEqual(["status.editor.encoding", "extensions.status.editor.encoding"]);
    });

    it("repeated update of the same handle edits the entry in place", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem());
        adapter.update(wireItem({ text: "Demo 42" }));

        expect(bar.entries()).toHaveLength(1);
        expect(entry(bar, "extensions.demo").text).toBe("Demo 42");
    });

    it("in-place edit does not recreate the entry: order of equal-priority entries does not shift", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ handle: 1, id: "a", alignment: "left", text: "A", priority: 10 }));
        adapter.update(wireItem({ handle: 2, id: "b", alignment: "left", text: "B", priority: 10 }));
        adapter.update(wireItem({ handle: 1, id: "a", alignment: "left", text: "A2", priority: 10 }));

        // A recreated entry would move to the end of its side.
        expect(bar.entries().map((e) => e.text)).toEqual(["A2", "B"]);
    });

    it("priority reaches the entry as is", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ priority: 100 }));
        adapter.update(wireItem({ priority: 42 }));

        expect(entry(bar, "extensions.demo").priority).toBe(42);
    });

    it("edit without a name keeps the name, a new name is applied", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ name: "Status Bar Demo" }));
        adapter.update(wireItem({ text: "Demo 42" }));
        expect(entry(bar, "extensions.demo").name).toBe("Status Bar Demo");

        adapter.update(wireItem({ id: "demo", name: "Other name" }));
        expect(entry(bar, "extensions.demo").name).toBe("Other name");
    });

    it("changed id recreates the entry, the old one does not remain", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ id: "test.demo.item-1" }));
        adapter.update(wireItem({ id: "test.demo.status-bar-demo", name: "Status Bar Demo" }));

        expect(bar.entries().map((e) => e.id)).toEqual(["extensions.test.demo.status-bar-demo"]);
    });

    it("item without priority goes right of prioritized items on its side", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ handle: 1, id: "l-high", alignment: "left", text: "L-high", priority: 100 }));
        adapter.update(wireItem({ handle: 2, id: "l-low", alignment: "left", text: "L-low", priority: 10 }));
        adapter.update(wireItem({ handle: 3, id: "l-none", alignment: "left", text: "L-none" }));

        expect(bar.entries().map((e) => e.text)).toEqual(["L-high", "L-low", "L-none"]);
    });

    it("two items without priority keep insertion order", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ handle: 1, id: "a", alignment: "left", text: "A" }));
        adapter.update(wireItem({ handle: 2, id: "b", alignment: "left", text: "B" }));

        expect(bar.entries().map((e) => e.text)).toEqual(["A", "B"]);
    });

    it("remove drops the entry; repeated remove is a no-op", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem());
        adapter.remove(1);
        adapter.remove(1);

        expect(bar.entries()).toEqual([]);
    });

    it("clear drops all items (subprocess death)", () => {
        const { bar, adapter } = makeAdapter();
        bar.addEntry({ id: "status.editor.encoding", text: "UTF-8", alignment: "right", priority: 30 });
        adapter.update(wireItem({ handle: 1, id: "a", text: "A" }));
        adapter.update(wireItem({ handle: 2, id: "b", text: "B" }));
        adapter.clear();

        expect(bar.entries().map((e) => e.id)).toEqual(["status.editor.encoding"]);
    });

    it("after clear the same handle creates the entry again (subprocess respawn)", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem());
        adapter.clear();
        adapter.update(wireItem());

        expect(bar.entries().map((e) => e.id)).toEqual(["extensions.demo"]);
    });

    it("click runs the item command with its arguments", () => {
        const { bar, adapter, calls } = makeAdapter();
        adapter.update(wireItem({ command: "demo.click", arguments: [1, "two"] }));
        entry(bar, "extensions.demo").onClick?.();

        expect(calls).toEqual([{ id: "demo.click", args: [1, "two"] }]);
    });

    it("click uses the command from the LAST update, not from entry creation", () => {
        const { bar, adapter, calls } = makeAdapter();
        adapter.update(wireItem({ command: "demo.first" }));
        adapter.update(wireItem({ command: "demo.second", arguments: ["x"] }));
        entry(bar, "extensions.demo").onClick?.();

        expect(calls).toEqual([{ id: "demo.second", args: ["x"] }]);
    });

    it("command without arguments is called with an empty list", () => {
        const { bar, adapter, calls } = makeAdapter();
        adapter.update(wireItem({ command: "demo.click" }));
        entry(bar, "extensions.demo").onClick?.();

        expect(calls).toEqual([{ id: "demo.click", args: [] }]);
    });

    it("edit that drops arguments drops them from the click too", () => {
        const { bar, adapter, calls } = makeAdapter();
        adapter.update(wireItem({ command: "demo.click", arguments: [1] }));
        adapter.update(wireItem({ command: "demo.click" }));
        entry(bar, "extensions.demo").onClick?.();

        expect(calls).toEqual([{ id: "demo.click", args: [] }]);
    });

    it("item without a command is inert but clickable", () => {
        const { bar, adapter, calls } = makeAdapter();
        adapter.update(wireItem());
        const clickable = entry(bar, "extensions.demo").onClick;
        clickable?.();

        expect(clickable).toBeTypeOf("function");
        expect(calls).toEqual([]);
    });

    it("failing command does not crash the editor, it goes to the log", () => {
        const { bar, adapter, errors } = makeAdapter(() => {
            throw new Error("boom");
        });
        adapter.update(wireItem({ command: "demo.broken" }));

        expect(() => entry(bar, "extensions.demo").onClick?.()).not.toThrow();
        expect(errors).toEqual(['status bar command "demo.broken" failed']);
    });

    it("rejected command promise goes to the log too", async () => {
        const { bar, adapter, errors } = makeAdapter(() => Promise.reject(new Error("boom")));
        adapter.update(wireItem({ command: "demo.async" }));
        entry(bar, "extensions.demo").onClick?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(errors).toEqual(['status bar command "demo.async" failed']);
    });

    it("successful command does not log", async () => {
        const { bar, adapter, errors } = makeAdapter(() => Promise.resolve("ok"));
        adapter.update(wireItem({ command: "demo.ok" }));
        entry(bar, "extensions.demo").onClick?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(errors).toEqual([]);
    });

    it("without a logger a failing command still does not crash the editor", () => {
        const bar = new StatusBarService(NULL_STATE_SERVICE);
        const { service } = makeCommands(() => {
            throw new Error("boom");
        });
        const adapter = new ExtensionStatusBarAdapter(bar, service);
        adapter.update(wireItem({ command: "demo.broken" }));

        expect(() => entry(bar, "extensions.demo").onClick?.()).not.toThrow();
    });

    it("item hidden by the user stays hidden no matter how many updates arrive", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ name: "Status Bar Demo" }));
        bar.setHidden("extensions.demo", true);
        adapter.update(wireItem({ name: "Status Bar Demo", text: "Demo 42" }));

        expect(bar.entries()).toEqual([]);
        expect(bar.allEntries().map((e) => e.text)).toEqual(["Demo 42"]);
    });

    it("switching diode.icons.nerdFont re-renders the icons of the items already shown", async () => {
        const bar = new StatusBarService(NULL_STATE_SERVICE);
        const { icons, set } = createSwitchableIcons(true);
        const adapter = new ExtensionStatusBarAdapter(bar, makeCommands().service, undefined, icons);
        adapter.update(wireItem({ text: "$(check) Demo", name: "$(check) Status" }));
        expect(entry(bar, "extensions.demo").text).toBe(`${CODICON_GLYPHS.check ?? ""} Demo`);

        await set(false);
        expect(entry(bar, "extensions.demo")).toMatchObject({ text: "✓ Demo", name: "✓ Status" });

        await set(true);
        expect(entry(bar, "extensions.demo").text).toBe(`${CODICON_GLYPHS.check ?? ""} Demo`);
    });
});

describe("renderStatusBarItemText", () => {
    it("substitutes the icon for the markup", () => {
        expect(renderStatusBarItemText("$(check) Demo")).toBe(`${CODICON_GLYPHS.check ?? ""} Demo`);
    });

    it("truncates long text with an ellipsis", () => {
        const rendered = renderStatusBarItemText("x".repeat(200));

        expect(rendered).toBe(`${"x".repeat(23)}…`);
    });

    it("text exactly at the limit is not truncated", () => {
        expect(renderStatusBarItemText("y".repeat(24))).toBe("y".repeat(24));
    });

    it("text one character over the limit is truncated", () => {
        expect(renderStatusBarItemText("y".repeat(25))).toBe(`${"y".repeat(23)}…`);
    });

    it("truncates by code points without splitting a surrogate pair", () => {
        const rendered = renderStatusBarItemText("🙂".repeat(10), 5);

        expect(rendered).toBe(`${"🙂".repeat(4)}…`);
    });

    it("item made only of unknown icons gets a fallback character", () => {
        expect(renderStatusBarItemText("$(definitely-not-a-codicon)")).toBe("•");
    });

    it("empty text is the extension's own choice, no fallback character", () => {
        expect(renderStatusBarItemText("")).toBe("");
    });

    it("whitespace-only text also gets a fallback character", () => {
        expect(renderStatusBarItemText("   ")).toBe("•");
    });

    it("icon without text stays visible on its own", () => {
        expect(renderStatusBarItemText("$(sync~spin)")).toBe(CODICON_GLYPHS.sync);
    });
});
