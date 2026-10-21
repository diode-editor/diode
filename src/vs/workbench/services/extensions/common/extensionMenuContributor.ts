import { CODICON_GLYPHS } from "../../../../base/common/codicons.generated.ts";
import type { IMenuContribution, ISubmenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type {
    IExtensionMenuItemContribution,
    IExtensionSubmenuContribution,
} from "../../../../platform/extensions/common/iExtensionManifest.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

// Явный список: точка, которой у нас нет, не должна притвориться соседней — пропуск со строкой
// в лог. `Partial`: промах по таблице обязан читаться как `undefined`.
const MENU_IDS: Readonly<Partial<Record<string, MenuId>>> = {
    "editor/context": MenuId.EditorContext,
    "editor/title": MenuId.EditorTitle,
    "editor/title/context": MenuId.EditorTitleContext,
    "explorer/context": MenuId.ExplorerContext,
    "scm/resourceState/context": MenuId.ScmContext,
    "scm/resourceGroup/context": MenuId.ScmResourceGroupContext,
    "scm/historyItem/context": MenuId.ScmGraphContext,
    "view/title": MenuId.ViewTitle,
    "viewContainer/title": MenuId.ViewContainerTitle,
};

const COMMAND_PALETTE_MENU = "commandPalette";

// Мост зовут повторно, а `MenuId` уникален в процессе — точка одного подменю обязана быть той же.
const extensionSubmenuIds = new Map<string, MenuId>();

function submenuMenuId(id: string): MenuId {
    const existing = extensionSubmenuIds.get(id);
    if (existing !== undefined) return existing;
    const created = new MenuId(id);
    extensionSubmenuIds.set(id, created);
    return created;
}

export function parseMenuGroup(raw: string | undefined): { group?: string; order?: number } {
    if (raw === undefined) return {};
    const at = raw.lastIndexOf("@");
    if (at < 0) return raw === "" ? {} : { group: raw };
    const group = raw.slice(0, at);
    const order = Number(raw.slice(at + 1));
    return {
        ...(group === "" ? {} : { group }),
        // Нечисловой порядок — как его отсутствие, а не `NaN` в начало.
        ...(Number.isFinite(order) ? { order } : {}),
    };
}

/**
 * Аналог `menusExtensionPoint.ts` VS Code. Битый пункт манифеста — строка в лог и пропуск,
 * а не исключение: манифест пишет чужой человек.
 */
export function registerExtensionMenus(
    extensions: readonly IExtension[],
    menuRegistry: MenuRegistry,
    logger?: ILogger,
): { dispose(): void } {
    const disposables: { dispose(): void }[] = [];
    // Иконка — у команды, а не у пункта (как `MenuItemAction` эталона).
    const icons = commandIcons(extensions);
    for (const ext of extensions) {
        const contributes = ext.manifest.contributes;
        if (contributes === undefined) continue;
        const submenus = declaredSubmenus(ext.id, contributes.submenus, logger);
        for (const [menu, items] of Object.entries(contributes.menus ?? {})) {
            const menuId = MENU_IDS[menu] ?? submenus.get(menu)?.menuId;
            if (menuId === undefined) {
                // Палитра про `when` расширений пока не знает — пункт не теряется молча.
                logger?.info(
                    menu === COMMAND_PALETTE_MENU
                        ? `${ext.id}: пункты "commandPalette" пока не применяются`
                        : `${ext.id}: неизвестная точка меню "${menu}" — пункты пропущены`,
                );
                continue;
            }
            for (const item of items) {
                const contribution = toContribution(ext.id, menuId, item, submenus, icons, logger);
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

/** Префикс расширения: `"myext.submenu"` могут объявить два расширения. */
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

/** `null` — пункт пропущен, причина уже в логе. */
function toContribution(
    extensionId: string,
    menuId: MenuId,
    item: IExtensionMenuItemContribution,
    submenus: ReadonlyMap<string, { readonly menuId: MenuId; readonly label: string }>,
    icons: ReadonlyMap<string, string | undefined>,
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
    // `alt` принимаем, но не рисуем: альтернативного действия у наших попапов нет.
    const icon = icons.get(item.command);
    return {
        menuId,
        command: item.command,
        icon,
        ...(typeof item.title === "string" && item.title !== "" ? { title: item.title } : {}),
        ...placement,
    };
}

/** Как `ThemeIcon.fromString` эталона; модификатор (`~spin`) не рисуем. */
const THEME_ICON = /^\$\(([a-z0-9-]+)(?:~[a-z0-9-]+)?\)$/u;

/** SVG-иконку в терминале не нарисовать — у такой команды иконки нет. */
function commandIcons(extensions: readonly IExtension[]): Map<string, string | undefined> {
    const icons = new Map<string, string | undefined>();
    for (const ext of extensions) {
        // Stryker disable next-line ArrayDeclaration: без команд перебирать нечего — у элементов подставной строки нет `icon`, их отсекает проверка ниже
        for (const command of ext.manifest.contributes?.commands ?? []) {
            // Stryker disable next-line ConditionalExpression: сужение для TS — SVG-объект под регуляркой стал бы строкой «[object Object]» и не совпал
            const match = typeof command.icon === "string" ? THEME_ICON.exec(command.icon) : null;
            if (match !== null) icons.set(command.command, CODICON_GLYPHS[match[1]]);
        }
    }
    return icons;
}
