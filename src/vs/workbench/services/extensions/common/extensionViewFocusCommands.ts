import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IViewContribution } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

/**
 * В эталоне `<вид>.focus` есть у каждого вида, и чат-расширения зовут её перед сообщением панели
 * (Supermaven). Виды мы не рисуем, а без команды расширение ловило бы «command not found» —
 * поэтому команда сообщает человеку, что вид не показать, и разрешается без ошибки.
 * Отступление: в палитру не попадает — пункт, всегда отвечающий «не показать», был бы обманом.
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
