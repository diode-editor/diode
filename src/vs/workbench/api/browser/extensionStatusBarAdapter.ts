import { renderCodicons } from "../../../base/common/codicons.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../services/statusbar/common/statusBarService.ts";
import type { ICommandService } from "../common/iCommandService.ts";
import type { IStatusBarItemSink } from "../common/iExtensionWindowSinks.ts";
import type { IWireStatusBarItem } from "../common/wireTypes.ts";

/** Расширение не может ни перебить встроенный сегмент, ни скрыть его через меню видимости. */
export const EXTENSION_ENTRY_PREFIX = "extensions.";

/**
 * В VS Code пункт без `priority` встаёт правее всех. Не `-Number.MAX_SAFE_INTEGER`: разность
 * двух таких в компараторе должна оставаться конечной.
 */
const NO_PRIORITY = -1_000_000;

/**
 * Отклонение от VS Code (там полоса растёт): в терминале длинный пункт вытеснил бы `Ln X, Col Y`
 * и язык. 24 — треть 80 колонок, самой узкой ширины, где встроенная правая группа ещё помещается.
 */
const MAX_ITEM_WIDTH = 24;

/** Пункт, чей текст схлопнулся при подстановке значков, иначе стал бы невидим, а команда на нём жива. */
const FALLBACK_GLYPH = "•";

interface IItemRecord {
    readonly entryId: string;
    readonly bar: IStatusBarEntryHandle;
    command: string | undefined;
    args: readonly unknown[];
}

export function renderStatusBarItemText(raw: string, maxWidth: number = MAX_ITEM_WIDTH): string {
    const rendered = renderCodicons(raw);
    // Кодпоинтами, а не по `.length`: резать суррогатную пару пополам нельзя.
    const glyphs = Array.from(rendered);
    const clipped = glyphs.length > maxWidth ? `${glyphs.slice(0, maxWidth - 1).join("")}…` : rendered;
    if (clipped.trim() !== "") return clipped;
    // Пустой текст расширение выбрало само — это его право. А вот текст,
    // который был непустым и схлопнулся при подстановке, надо чем-то показать.
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
        // Имя — подпись пункта в меню видимости полосы, тоже ярлык.
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
        // Пункта ещё нет — либо у него сменился id (расширение задало имя уже
        // после показа). Id записи полосы поменять нельзя, поэтому пересоздаём.
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

    /** Команда расширения может отсутствовать или упасть — редактор не роняем, обе ветки в лог. */
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
