import { renderCodicons } from "../../../base/common/codicons.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../services/statusbar/common/statusBarService.ts";
import type { ICommandService } from "../common/iCommandService.ts";
import type { IStatusBarItemSink } from "../common/iExtensionWindowSinks.ts";
import type { IWireStatusBarItem } from "../common/wireTypes.ts";

/** An extension can neither override a built-in segment nor hide it via the visibility menu. */
export const EXTENSION_ENTRY_PREFIX = "extensions.";

/**
 * In VS Code an item without `priority` goes rightmost. Not `-Number.MAX_SAFE_INTEGER`: the difference
 * of two such values in the comparator must stay finite.
 */
const NO_PRIORITY = -1_000_000;

/**
 * Deviation from VS Code (where the bar grows): in a terminal a long item would push out `Ln X, Col Y`
 * and the language. 24 is a third of 80 columns, the narrowest width where the built-in right group still fits.
 */
const MAX_ITEM_WIDTH = 24;

/** An item whose text collapsed during icon substitution would otherwise be invisible while its command is live. */
const FALLBACK_GLYPH = "•";

interface IItemRecord {
    readonly entryId: string;
    readonly bar: IStatusBarEntryHandle;
    command: string | undefined;
    args: readonly unknown[];
}

export function renderStatusBarItemText(raw: string, maxWidth: number = MAX_ITEM_WIDTH): string {
    const rendered = renderCodicons(raw);
    // By code points, not `.length`: a surrogate pair must not be cut in half.
    const glyphs = Array.from(rendered);
    const clipped = glyphs.length > maxWidth ? `${glyphs.slice(0, maxWidth - 1).join("")}…` : rendered;
    if (clipped.trim() !== "") return clipped;
    // An empty text is the extension's own choice, and its right. But text that was
    // non-empty and collapsed during substitution must be shown somehow.
    return raw === "" ? "" : FALLBACK_GLYPH;
}

function entryFields(item: IWireStatusBarItem): {
    text: string;
    alignment: "left" | "right";
    priority: number;
    name?: string;
} {
    return {
        text: renderStatusBarItemText(item.text),
        alignment: item.alignment,
        priority: item.priority ?? NO_PRIORITY,
        // The name is the item's caption in the bar's visibility menu, also a label.
        ...(item.name !== undefined ? { name: renderCodicons(item.name) } : {}),
    };
}

export class ExtensionStatusBarAdapter implements IStatusBarItemSink {
    private readonly items = new Map<number, IItemRecord>();

    public constructor(
        private readonly statusBar: StatusBarService,
        private readonly commands: ICommandService,
        private readonly logger?: ILogger,
    ) {}

    public update(item: IWireStatusBarItem): void {
        const entryId = EXTENSION_ENTRY_PREFIX + item.id;
        const existing = this.items.get(item.handle);
        if (existing?.entryId === entryId) {
            existing.command = item.command;
            existing.args = item.arguments ?? [];
            existing.bar.update(entryFields(item));
            return;
        }
        // No item yet, or its id changed (the extension set the name after
        // showing it). A bar entry's id cannot change, so recreate it.
        this.remove(item.handle);
        const record: IItemRecord = {
            entryId,
            command: item.command,
            args: item.arguments ?? [],
            bar: this.statusBar.addEntry({
                id: entryId,
                ...entryFields(item),
                onClick: () => {
                    this.runCommand(record);
                },
            }),
        };
        this.items.set(item.handle, record);
    }

    public remove(handle: number): void {
        const record = this.items.get(handle);
        if (record === undefined) return;
        this.items.delete(handle);
        record.bar.dispose();
    }

    public clear(): void {
        for (const handle of [...this.items.keys()]) this.remove(handle);
    }

    /** The extension's command may be missing or throw: don't crash the editor, log both cases. */
    private runCommand(record: IItemRecord): void {
        const command = record.command;
        if (command === undefined) return;
        const fail = (err: unknown): void => {
            this.logger?.error(`status bar command "${command}" failed`, err);
        };
        try {
            void Promise.resolve(this.commands.execute(command, record.args)).catch(fail);
        } catch (err) {
            fail(err);
        }
    }
}
