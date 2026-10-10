import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IViewContribution } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

/**
 * Команды `<viewId>.focus` для видов из `contributes.views` всех расширений.
 *
 * В эталоне такую команду получает КАЖДЫЙ зарегистрированный вид
 * (`ViewsService.registerFocusViewAction`), и расширения на неё опираются:
 * чат-расширение «показывает» свою панель вызовом `executeCommand("<вид>.focus")`
 * перед тем, как послать ей сообщение (Supermaven: «Fix with Supermaven»,
 * «Add to Chat», «New Conversation»). Виды расширений Diode пока не рисует
 * (деревья — Phase 8b, webview — не будет by design), и без команды вызов
 * отказывал «command not found» необработанным отказом в недрах расширения —
 * пользователь не видел ничего.
 *
 * Поэтому команда есть, а её исполнение честно сообщает человеку, что вид не
 * показать (`notify`), и разрешается без ошибки — расширение продолжает своё.
 * Отступление от эталона: в палитру команда не попадает (без заголовка) —
 * пункт «Focus on … View», который всегда отвечает «не показать», в палитре
 * был бы обманом.
 *
 * Вид без строкового `id` — строка в лог и пропуск. Команда, которую уже кто-то
 * завёл (встроенная с тем же id), не перебивается.
 */
export function registerExtensionViewFocusCommands(
    extensions: readonly IExtension[],
    commands: CommandRegistry,
    notify: (message: string) => void,
    logger?: ILogger,
): IDisposable {
    const disposables: IDisposable[] = [];
    for (const ext of extensions) {
        const views = ext.manifest.contributes?.views;
        if (views === undefined) continue;
        const displayName = ext.manifest.displayName;
        const owner = typeof displayName === "string" && displayName !== "" ? displayName : ext.id;
        for (const [container, list] of Object.entries(views)) {
            // Манифест пишет чужой человек: значение контейнера — не обязательно список.
            const entries: readonly IViewContribution[] = Array.isArray(list)
                ? (list as readonly IViewContribution[])
                : [];
            for (const view of entries) {
                if (typeof view.id !== "string" || view.id === "") {
                    logger?.info(`${ext.id}: вид без id в контейнере "${container}" — пропущен`);
                    continue;
                }
                const id = `${view.id}.focus`;
                if (commands.has(id)) continue;
                const name = typeof view.name === "string" && view.name !== "" ? view.name : view.id;
                const message =
                    view.type === "webview"
                        ? `${owner}: view "${name}" is a webview — webviews can't be shown in the terminal`
                        : `${owner}: view "${name}" can't be shown — extension views aren't supported yet`;
                disposables.push(
                    commands.register(id, () => {
                        notify(message);
                    }),
                );
            }
        }
    }
    return {
        dispose: () => {
            for (const disposable of disposables) disposable.dispose();
        },
    };
}
