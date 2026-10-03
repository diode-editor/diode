import type { FuzzyMatch } from "../../../../base/common/fuzzySearch.ts";
import { fuzzyMatchPrepared, prepareQuery } from "../../../../base/common/fuzzySearch.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { commandPaletteLabel, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    formatKeybinding,
    keybindingLabelStyle,
    KeybindingRegistryDIToken,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../common/iQuickAccessProvider.ts";

import { toMatchRanges } from "./pathMatchRanges.ts";

export const CommandsQuickAccessProviderDIToken = token<CommandsQuickAccessProvider>("CommandsQuickAccessProvider");

/** Команда, прошедшая фильтр: подпись и совпадение запроса с ней. */
interface MatchedCommand {
    readonly id: string;
    readonly label: string;
    readonly match: FuzzyMatch;
}

/**
 * Command palette (`>`): команды с заголовками из {@link CommandRegistry},
 * fuzzy-фильтр по подписи, шорткат — актуальный кейбинд команды в текущем
 * контексте.
 *
 * Подпись — `category: title` ({@link commandPaletteLabel}), как в VS Code:
 * «Java: Switch to Standard Mode». Фильтр идёт по ней же, то есть набранное
 * `java` находит все команды группы Java.
 *
 * Фильтр — тот же `prepareQuery`, что у файлового пикера: пробел разделяет
 * термы, совпасть обязаны все. Поэтому `go line` находит «Go to Line/Column…»
 * (на подстрочном поиске запрос не находил ничего), а `toggle panel` —
 * «View: Toggle Panel Visibility». Список сортируется по очкам совпадения;
 * сортировка стабильная, так что у пустого запроса порядок остаётся порядком
 * реестра.
 */
export class CommandsQuickAccessProvider implements IQuickAccessProvider {
    public static readonly PREFIX = ">";

    public static dependencies = [CommandRegistryDIToken, KeybindingRegistryDIToken, ContextKeyServiceDIToken] as const;

    public constructor(
        private readonly commands: CommandRegistry,
        private readonly keybindings: KeybindingRegistry,
        private readonly contextKeys: ContextKeyService,
    ) {}

    public getPlaceholder(): string {
        return "Show All Commands";
    }

    public getItems(query: string): QuickAccessItem[] {
        // Запрос разбирается один раз на показ, а не на каждую команду.
        const prepared = prepareQuery(query.slice(CommandsQuickAccessProvider.PREFIX.length));
        // Недоступную сейчас команду не показываем вовсе — так же поступает
        // VS Code: `precondition` уезжает в `when` пункта палитры. Гасить пункт
        // на месте мы не умеем, а показывать неработающий — хуже, чем не
        // показывать (исполнить его всё равно не даст guard самой команды).
        const all = this.commands
            .listCommands()
            .filter((cmd) => cmd.enablement === undefined || this.contextKeys.evaluate(cmd.enablement));

        // Отдельной ветки под пустой запрос нет: он совпадает с любой подписью
        // на нулевые очки и без подсветки, то есть фильтр сам отдаёт весь список.
        const matched = all.flatMap((cmd): MatchedCommand[] => {
            const label = commandPaletteLabel(cmd);
            const match = fuzzyMatchPrepared(prepared, label);
            return match === null ? [] : [{ id: cmd.id, label, match }];
        });
        matched.sort((a, b) => b.match.score - a.match.score);

        return matched.map(({ id, label, match }): QuickAccessItem => {
            const chord = this.keybindings.getKeybindingForCommand(id, this.contextKeys);
            return {
                label,
                labelMatchRanges: toMatchRanges(match.matchedIndices),
                shortcut: chord ? formatKeybinding(chord, keybindingLabelStyle(this.contextKeys)) : undefined,
                accept: () => {
                    this.commands.execute(id);
                },
            };
        });
    }
}
