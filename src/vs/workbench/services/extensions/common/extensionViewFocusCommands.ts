import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IViewContribution } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

/**
 * Upstream, every view has `<view>.focus`, and chat extensions call it before messaging the panel
 * (Supermaven). We don't render views, and without the command the extension would get
 * "command not found", so the command tells the user the view can't be shown and resolves without an error.
 * Deviation: not in the command palette; an item that always answers "can't show" would be a lie.
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
            // The manifest is written by a stranger: a container value isn't necessarily a list.
            const entries: readonly IViewContribution[] = Array.isArray(list)
                ? (list as readonly IViewContribution[])
                : [];
            for (const view of entries) {
                if (typeof view.id !== "string" || view.id === "") {
                    logger?.info(`${ext.id}: view without id in container "${container}", skipped`);
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
