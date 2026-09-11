import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import { type KeybindingRegistry, parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IKeybindingContribution } from "../../../../platform/extensions/common/iExtensionManifest.ts";

/**
 * Регистрирует `contributes.keybindings` расширений в {@link KeybindingRegistry}.
 *
 * `key` (или платформенный оверрайд `mac`/`linux`/`win`) парсится как аккорд
 * (`parseChord`), `when` прокидывается как when-выражение. Команда с ведущим `-`
 * (`"-editor.action.foo"`) снимает привязку, как в VS Code. Порядок важен:
 * extension-биндинги регистрируются ПОСЛЕ builtin — резолвер идёт с конца, так
 * что расширение переопределяет встроенную привязку того же аккорда (VS Code
 * parity). Команда сама по себе резолвится через `CommandRegistry` (builtin
 * action либо прокси extension-команды из ExtensionHost).
 */
export function registerExtensionKeybindings(
    extensions: readonly IExtension[],
    keybindingRegistry: KeybindingRegistry,
    platform: NodeJS.Platform,
    logger?: ILogger,
): void {
    for (const ext of extensions) {
        const keybindings = ext.manifest.contributes?.keybindings;
        if (keybindings === undefined) continue;
        for (const kb of keybindings) {
            try {
                applyKeybinding(kb, keybindingRegistry, platform);
            } catch (err) {
                logger?.warn(`${ext.id}: не удалось применить keybinding "${kb.key}" → ${kb.command}`, err);
            }
        }
    }
}

/** Разрешает платформенный оверрайд привязки поверх кросс-платформенного `key`. */
function resolveKey(kb: IKeybindingContribution, platform: NodeJS.Platform): string | undefined {
    const override = platform === "darwin" ? kb.mac : platform === "win32" ? kb.win : kb.linux;
    const key = override ?? kb.key;
    return typeof key === "string" && key.trim() !== "" ? key : undefined;
}

function applyKeybinding(kb: IKeybindingContribution, registry: KeybindingRegistry, platform: NodeJS.Platform): void {
    const key = resolveKey(kb, platform);
    // resolveKey уже отсеял пустой/пробельный key, поэтому parseChord даёт ≥1 аккорд.
    if (key === undefined) return;
    const chord = parseChord(key);

    // Ведущий `-` в command — снятие привязки (VS Code `-command`).
    if (kb.command.startsWith("-")) {
        registry.removeBindings(kb.command.slice(1), chord);
        return;
    }
    registry.register(chord, kb.command, kb.when, "extension");
}
