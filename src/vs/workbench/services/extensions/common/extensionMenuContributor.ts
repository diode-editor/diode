import type { IMenuContribution, ISubmenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type {
    IExtensionMenuItemContribution,
    IExtensionSubmenuContribution,
} from "../../../../platform/extensions/common/iExtensionManifest.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

/**
 * Строковые id точек меню VS Code → наши `MenuId`. Список намеренно явный:
 * точка, которой у нас нет (`timeline/item/context`, `notebook/cell/title`, …),
 * не должна молча притвориться соседней — она отваливается с одной строкой в
 * лог, и расширение живёт дальше без этого пункта (тот же принцип, что у
 * webview-заглушки: «расширение без панели, а не мёртвое расширение»).
 */
// `Partial`: ключ — произвольная строка из чужого манифеста, и промах по
// таблице обязан читаться как `undefined`, а не как «всегда есть».
const MENU_IDS: Readonly<Partial<Record<string, MenuId>>> = {
    "editor/context": MenuId.EditorContext,
    "editor/title/context": MenuId.EditorTitleContext,
    "explorer/context": MenuId.ExplorerContext,
    "scm/resourceState/context": MenuId.ScmContext,
    "scm/resourceGroup/context": MenuId.ScmResourceGroupContext,
    "scm/historyItem/context": MenuId.ScmGraphContext,
    "view/title": MenuId.ViewTitle,
    "viewContainer/title": MenuId.ViewContainerTitle,
};

/**
 * Точка `commandPalette` — не меню, а фильтр видимости команд в палитре
 * (VS Code: `when` решает, показывать ли команду). Своей точки у нас нет;
 * пункты отсюда не теряются молча — про них говорит та же строка в лог.
 */
const COMMAND_PALETTE_MENU = "commandPalette";

/**
 * Точки собственных подменю расширений по их полному id. `MenuId` требует
 * уникальности id в процессе, а мост зовут повторно (смена состава расширений,
 * второй профиль в тестах) — точка одного и того же подменю обязана быть ТОЙ ЖЕ,
 * иначе второй вызов упал бы на «MenuId уже существует».
 */
const extensionSubmenuIds = new Map<string, MenuId>();

function submenuMenuId(id: string): MenuId {
    const existing = extensionSubmenuIds.get(id);
    if (existing !== undefined) return existing;
    const created = new MenuId(id);
    extensionSubmenuIds.set(id, created);
    return created;
}

/** Группа и порядок из строки `"группа@порядок"` манифеста. */
export function parseMenuGroup(raw: string | undefined): { group?: string; order?: number } {
    if (raw === undefined) return {};
    const at = raw.lastIndexOf("@");
    if (at < 0) return raw === "" ? {} : { group: raw };
    const group = raw.slice(0, at);
    const order = Number(raw.slice(at + 1));
    return {
        ...(group === "" ? {} : { group }),
        // Нечисловой порядок (`"navigation@x"`) — как его отсутствие: пункт
        // встаёт по месту в манифесте, а не уезжает в начало с `NaN`.
        ...(Number.isFinite(order) ? { order } : {}),
    };
}

/**
 * Регистрирует `contributes.menus` / `contributes.submenus` всех расширений в
 * {@link MenuRegistry} (аналог `menusExtensionPoint.ts` VS Code).
 *
 * Правила разбора — как в эталоне: `group@order` разбирается на группу и
 * порядок, `when` уезжает when-выражением, пункт со ссылкой `submenu`
 * становится вложенной точкой (её объявляет `contributes.submenus` того же
 * расширения). Label пункта берётся из `contributes.commands` — здесь его нет,
 * и его резолвит сам реестр по id команды.
 *
 * Неизвестный id точки, пункт без команды и подменю, ссылка на необъявленное
 * подменю — **строка в лог и пропуск пункта**, а не исключение: манифест пишет
 * чужой человек, и падать на нём нельзя.
 *
 * Возвращает снятие всех зарегистрированных пунктов (как `appendMenuItem`):
 * перерегистрация после смены состава расширений снимает старые.
 */
export function registerExtensionMenus(
    extensions: readonly IExtension[],
    menuRegistry: MenuRegistry,
    logger?: ILogger,
): { dispose(): void } {
    const disposables: { dispose(): void }[] = [];
    for (const ext of extensions) {
        const contributes = ext.manifest.contributes;
        if (contributes === undefined) continue;
        const submenus = declaredSubmenus(ext.id, contributes.submenus, logger);
        for (const [menu, items] of Object.entries(contributes.menus ?? {})) {
            // Ключом может быть и собственное подменю расширения — пункты под
            // ним наполняют вложенную точку (так эталон и описывает submenus).
            const menuId = MENU_IDS[menu] ?? submenus.get(menu)?.menuId;
            if (menuId === undefined) {
                // Палитра про `when` расширений пока не знает — пункт не
                // теряется молча, про него есть строка в логе.
                logger?.info(
                    menu === COMMAND_PALETTE_MENU
                        ? `${ext.id}: пункты "commandPalette" пока не применяются`
                        : `${ext.id}: неизвестная точка меню "${menu}" — пункты пропущены`,
                );
                continue;
            }
            for (const item of items) {
                const contribution = toContribution(ext.id, menuId, item, submenus, logger);
                if (contribution !== null) disposables.push(menuRegistry.appendMenuItem(contribution));
            }
        }
    }
    return {
        dispose: () => {
            for (const disposable of disposables) disposable.dispose();
        },
    };
}

/**
 * Точки собственных подменю расширения: `id` из манифеста → `MenuId` с
 * префиксом расширения (id точек глобально уникальны, а `"myext.submenu"` два
 * расширения объявить могут).
 */
function declaredSubmenus(
    extensionId: string,
    declarations: readonly IExtensionSubmenuContribution[] | undefined,
    logger?: ILogger,
): Map<string, { readonly menuId: MenuId; readonly label: string }> {
    const result = new Map<string, { menuId: MenuId; label: string }>();
    for (const declaration of declarations ?? []) {
        if (typeof declaration.id !== "string" || declaration.id === "") {
            logger?.info(`${extensionId}: подменю без id — объявление пропущено`);
            continue;
        }
        if (result.has(declaration.id)) {
            logger?.info(`${extensionId}: подменю "${declaration.id}" объявлено дважды — второе пропущено`);
            continue;
        }
        result.set(declaration.id, {
            menuId: submenuMenuId(`ext:${extensionId}:${declaration.id}`),
            label: typeof declaration.label === "string" ? declaration.label : declaration.id,
        });
    }
    return result;
}

/** Пункт манифеста → запись реестра; `null` — пункт пропущен (причина уже в логе). */
function toContribution(
    extensionId: string,
    menuId: MenuId,
    item: IExtensionMenuItemContribution,
    submenus: ReadonlyMap<string, { readonly menuId: MenuId; readonly label: string }>,
    logger?: ILogger,
): IMenuContribution | ISubmenuContribution | null {
    const placement = {
        ...parseMenuGroup(typeof item.group === "string" ? item.group : undefined),
        ...(typeof item.when === "string" ? { when: item.when } : {}),
    };
    if (typeof item.submenu === "string") {
        const declared = submenus.get(item.submenu);
        if (declared === undefined) {
            logger?.info(
                `${extensionId}: подменю "${item.submenu}" не объявлено в contributes.submenus — пункт пропущен`,
            );
            return null;
        }
        return { menuId, submenu: declared.menuId, title: declared.label, ...placement };
    }
    if (typeof item.command !== "string" || item.command === "") {
        logger?.info(`${extensionId}: пункт меню без command и submenu — пропущен`);
        return null;
    }
    // `alt` (команда под Alt) манифеста принимаем, но не рисуем: альтернативного
    // действия у наших попапов нет, и обещать его подписью нельзя.
    return {
        menuId,
        command: item.command,
        // Свой label пункта (эталон разрешает переопределять титул команды в
        // конкретной точке); без него label резолвит реестр по id команды.
        ...(typeof item.title === "string" && item.title !== "" ? { title: item.title } : {}),
        ...placement,
    };
}
