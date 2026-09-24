import { renderCodicons } from "../../../base/common/codicons.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import type { IStatusBarItemSink } from "../../services/extensions/node/extensionHost.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../services/statusbar/common/statusBarService.ts";
import type { ICommandService } from "../common/iCommandService.ts";
import type { IWireStatusBarItem } from "../common/wireTypes.ts";

/**
 * Префикс id записей, пришедших от расширений. Разделяет пространства имён:
 * расширение не может ни перебить встроенный сегмент (`status.editor.encoding`),
 * ни скрыть его через меню видимости, каким бы id оно ни назвалось.
 */
export const EXTENSION_ENTRY_PREFIX = "extensions.";

/**
 * Приоритет пункта, созданного без `priority`. В VS Code такой пункт встаёт
 * правее всех приоритетных внутри своей стороны; у нас порядок — по убыванию
 * priority, поэтому «без приоритета» = очень маленькое число. Не
 * `-Number.MAX_SAFE_INTEGER`: разность двух таких в компараторе должна
 * оставаться конечной и равной нулю.
 */
const NO_PRIORITY = -1_000_000;

/**
 * Потолок ширины пункта расширения в символах. Отклонение от VS Code (там
 * полоса просто растёт): ширина терминала дефицитна, и текст на 200 символов
 * вытеснил бы за край `Ln X, Col Y` и язык. Хвост заменяется на «…».
 *
 * Почему 24, а не «треть ширины полосы»: полоса режется по фактической ширине
 * уже на уровне layout'а, а число здесь — про то, сколько один пункт вправе
 * отъесть у встроенных сегментов. 24 — примерно треть 80 колонок, самой узкой
 * ширины, на которой встроенная правая группа (`Ln X, Col Y`, отступ, кодировка,
 * EOL, язык) ещё помещается целиком. Настоящим пунктам расширений этого хватает
 * с запасом (`$(check) Ready`, `Supermaven Pro`), режется только злоупотребление.
 */
const MAX_ITEM_WIDTH = 24;

/**
 * Запасной видимый символ. Нужен пункту, от текста которого после подстановки
 * значков ничего не осталось (текст был только из неизвестных `$(name)`):
 * пустой пункт не видно и не по чему кликнуть, а команда на нём живая.
 */
const FALLBACK_GLYPH = "•";

/** Живой пункт: запись полосы + то, что нужно знать при клике. */
interface IItemRecord {
    /** Id записи в {@link StatusBarService} — по нему видно, что пункт «тот же». */
    readonly entryId: string;
    readonly bar: IStatusBarEntryHandle;
    command: string | undefined;
    args: readonly unknown[];
}

/**
 * Готовит текст пункта к показу в полосе: подставляет значки (`$(check)` →
 * глиф), режет длинный хвост и не даёт пункту стать невидимым.
 *
 * Экспортируется ради тестов — сама по себе логика чисто текстовая.
 */
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

/**
 * Мост `window.createStatusBarItem` расширений в статус-бар (реализация
 * {@link IStatusBarItemSink}): на каждый показанный пункт заводится запись
 * {@link StatusBarService}, клик по ней исполняет команду расширения.
 *
 * Все id записей живут под префиксом {@link EXTENSION_ENTRY_PREFIX}: так
 * пункты расширений не сталкиваются со встроенными сегментами. Видимость
 * остаётся за пользователем — скрытый через меню полосы id не покажется,
 * сколько бы `show()` расширение ни звало (фильтрует {@link StatusBarService}).
 *
 * Проводка — `extensionHostModule` (сток `ExtensionHost.statusBarItemSink`).
 */
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
        // Id записи сменился (расширение задало пункту имя уже после показа) —
        // старую запись снимаем: id записи полосы поменять нельзя.
        if (existing !== undefined && existing.entryId !== entryId) this.remove(item.handle);
        const current = this.items.get(item.handle);
        if (current !== undefined) {
            current.command = item.command;
            current.args = item.arguments ?? [];
            current.bar.update({
                text: renderStatusBarItemText(item.text),
                alignment: item.alignment,
                priority: item.priority ?? NO_PRIORITY,
                ...(item.name !== undefined ? { name: item.name } : {}),
                onClick: () => {
                    this.runCommand(current);
                },
            });
            return;
        }
        const record: IItemRecord = {
            entryId,
            command: item.command,
            args: item.arguments ?? [],
            bar: this.statusBar.addEntry({
                id: entryId,
                text: renderStatusBarItemText(item.text),
                alignment: item.alignment,
                priority: item.priority ?? NO_PRIORITY,
                ...(item.name !== undefined ? { name: item.name } : {}),
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

    /** Снимает все пункты: субпроцесс умер либо приложение выключается. */
    public clear(): void {
        for (const handle of [...this.items.keys()]) this.remove(handle);
    }

    /**
     * Исполняет команду пункта. Команда принадлежит расширению и может как
     * отсутствовать в реестре (расширение умерло между кликом и исполнением),
     * так и упасть — ни то, ни другое не должно ронять редактор, поэтому обе
     * ветки уходят в лог.
     */
    private runCommand(record: IItemRecord): void {
        const command = record.command;
        if (command === undefined) return;
        try {
            const result = this.commands.execute(command, record.args);
            void Promise.resolve(result).catch((err: unknown) => {
                this.logger?.error(`status bar command "${command}" failed`, err);
            });
        } catch (err) {
            this.logger?.error(`status bar command "${command}" failed`, err);
        }
    }
}
