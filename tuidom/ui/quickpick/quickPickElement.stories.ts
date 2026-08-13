import type { StoryContext, StoryMeta } from "../../testing/storyTypes.ts";
import { VStackElement } from "../layout/vStackElement.ts";

import type { QuickPickItem } from "./quickPickElement.ts";
import { QuickPickElement } from "./quickPickElement.ts";

export const meta: StoryMeta = {
    title: "QuickPickElement",
};

// ─── Sample data ─────────────────────────────────────────────────────────────

const FILE_ITEMS: QuickPickItem[] = [
    {
        icon: "\uf15b",
        label: "WorkbenchComponent.ts",
        description: "src/Workbench/Components/Shell/",
        labelMatchRanges: [[0, 3]],
    },
    {
        icon: "\uf15b",
        label: "Workbench.test.ts",
        description: "src/Workbench/Components/Shell/",
        labelMatchRanges: [[0, 3]],
    },
    {
        icon: "\uf15b",
        label: "Workbench.FileTree.test.ts",
        description: "src/Workbench/Components/Shell/",
        labelMatchRanges: [[0, 3]],
    },
    {
        icon: "\uf15b",
        label: "CommandAction.ts",
        description: "src/Workbench/Actions/",
    },
    {
        icon: "\uf481",
        label: "ARCHITECTURE.md",
        description: "docs/",
    },
    {
        icon: "\uf15b",
        label: "main.ts",
        description: "src/",
    },
    {
        icon: "\uf481",
        label: "README.md",
        description: ".",
    },
    {
        icon: "\uf15b",
        label: "ContextMenuItem.tsx",
        description: "src/components/widgets/popups/contextmenu/items/deeply/nested",
    },
    {
        icon: "\uf15b",
        label: "ThisIsAnExtremelyLongFileNameThatCannotPossiblyFitInThePicker.tsx",
        description: "src/very/deeply/nested/directory",
    },
];

const COMMAND_ITEMS: QuickPickItem[] = [
    {
        label: "Go to File…",
        description: "File",
        shortcut: "Ctrl+P",
        badge: "recently used",
    },
    {
        label: "Show All Commands",
        description: "View",
        shortcut: "Ctrl+Shift+P",
        badge: "recently used",
    },
    {
        label: "Open New Terminal",
        description: "Terminal",
        shortcut: "Ctrl+`",
    },
    {
        label: "Toggle Sidebar Visibility",
        description: "View",
        shortcut: "Ctrl+B",
    },
    {
        label: "Close Editor",
        description: "File",
        shortcut: "Ctrl+W",
        hint: "Configure Binding",
    },
    {
        label: "Save File",
        description: "File",
        shortcut: "Ctrl+S",
    },
    {
        label: "Undo",
        description: "Edit",
        shortcut: "Ctrl+Z",
    },
];

// ─── Stories ─────────────────────────────────────────────────────────────────

/** File picker: items with icons, description (path), and match highlights. */
export function fileSearch(ctx: StoryContext): void {
    ctx.body.title = "QuickPickElement — file search (type to filter label text)";

    const picker = new QuickPickElement();
    picker.placeholder = "Go to file…";
    picker.items = FILE_ITEMS;

    picker.onQueryChange = (query) => {
        if (query.trim() === "") {
            picker.items = FILE_ITEMS;
            return;
        }
        const q = query.toLowerCase();
        picker.items = FILE_ITEMS.filter((item) => item.label.toLowerCase().includes(q)).map((item) => ({
            ...item,
            // Simple highlight: mark first occurrence of query string
            labelMatchRanges: (() => {
                const idx = item.label.toLowerCase().indexOf(q);
                return idx >= 0 ? ([[idx, idx + q.length]] as [number, number][]) : [];
            })(),
        }));
    };

    picker.onAccept = (item) => {
        ctx.body.title = `Opened: ${item.description ?? ""}${item.label}`;
        picker.items = [];
    };

    picker.onCancel = () => {
        ctx.body.title = "Cancelled";
        picker.items = [];
    };

    // Centre the picker horizontally; place near top
    const stack = new VStackElement();
    stack.addChild(picker, { width: "fill", height: picker.maxVisibleItems + 4 });
    ctx.body.setContent(stack);

    ctx.afterRun(() => {
        picker.focus();
    });
}

/** Command palette: items with shortcuts, badges ("recently used"), and hints. */
export function commandPalette(ctx: StoryContext): void {
    ctx.body.title = "QuickPickElement — command palette (> mode)";

    const picker = new QuickPickElement();
    picker.placeholder = "> type a command…";
    picker.items = COMMAND_ITEMS;

    picker.onQueryChange = (query) => {
        const q = query.replace(/^>\s*/, "").toLowerCase();
        if (q === "") {
            picker.items = COMMAND_ITEMS;
            return;
        }
        picker.items = COMMAND_ITEMS.filter(
            (item) => item.label.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q),
        );
    };

    picker.onAccept = (item) => {
        ctx.body.title = `Executed: ${item.label}`;
    };

    picker.onCancel = () => {
        ctx.body.title = "Cancelled";
    };

    const stack = new VStackElement();
    stack.addChild(picker, { width: "fill", height: picker.maxVisibleItems + 4 });
    ctx.body.setContent(stack);

    ctx.afterRun(() => {
        picker.focus();
    });
}

/** Empty picker: no items, shows placeholder only. */
export function emptyPicker(ctx: StoryContext): void {
    ctx.body.title = "QuickPickElement — empty (no items)";

    const picker = new QuickPickElement();
    picker.placeholder = "No results — try a different query";
    picker.items = [];

    const stack = new VStackElement();
    stack.addChild(picker, { width: "fill", height: 3 });
    ctx.body.setContent(stack);

    ctx.afterRun(() => {
        picker.focus();
    });
}

/** Shows scroll behaviour: many items, only maxVisibleItems shown at a time. */
export function scrolling(ctx: StoryContext): void {
    ctx.body.title = "QuickPickElement — scroll (ArrowDown past visible window)";

    const items: QuickPickItem[] = Array.from({ length: 20 }, (_, i) => ({
        icon: "\uf15b",
        label: `file-${String(i + 1).padStart(2, "0")}.ts`,
        description: `src/module-${(i % 3) + 1}/`,
    }));

    const picker = new QuickPickElement();
    picker.placeholder = "Scroll with ArrowDown…";
    picker.maxVisibleItems = 6;
    picker.items = items;

    picker.onAccept = (item, index) => {
        ctx.body.title = `Accepted index ${index}: ${item.label}`;
    };

    const stack = new VStackElement();
    stack.addChild(picker, { width: "fill", height: picker.maxVisibleItems + 4 });
    ctx.body.setContent(stack);

    ctx.afterRun(() => {
        picker.focus();
    });
}
