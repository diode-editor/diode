import { combineWhen } from "../../../../platform/actions/common/commandAction.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IKeybindingContribution } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import {
    type IKeybindingLayerRule,
    type KeybindingRegistry,
    parseChord,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

type KeyboardOs = "mac" | "linux" | "windows";

const KEYBOARD_OSES: readonly KeyboardOs[] = ["mac", "linux", "windows"];

/**
 * Платформу выбирает не `process.platform`, а контекст-ключ `os`: по ssh с мака нужна
 * `mac`-ветка, а ответ уточняется после старта (XTVERSION, tmux). Поэтому регистрируются
 * все различающиеся варианты с условием `os == …`; приоритет задают слои реестра.
 */
export function registerExtensionKeybindings(
    extensions: readonly IExtension[],
    keybindingRegistry: KeybindingRegistry,
    logger?: ILogger,
): void {
    const rules: IKeybindingLayerRule[] = [];
    for (const ext of extensions) {
        const keybindings = ext.manifest.contributes?.keybindings;
        if (keybindings === undefined) continue;
        for (const kb of keybindings) {
            try {
                rules.push(...rulesOf(kb));
            } catch (err) {
                logger?.warn(`${ext.id}: не удалось применить keybinding "${kb.key}" → ${kb.command}`, err);
            }
        }
    }
    keybindingRegistry.setExtensionKeybindings(rules);
}

function keyFor(kb: IKeybindingContribution, os: KeyboardOs): string | undefined {
    const override = os === "mac" ? kb.mac : os === "windows" ? kb.win : kb.linux;
    const key = override ?? kb.key;
    return typeof key === "string" && key.trim() !== "" ? key : undefined;
}

function variantsOf(kb: IKeybindingContribution): { key: string; when: string | undefined }[] {
    const byKey = new Map<string, KeyboardOs[]>();
    for (const os of KEYBOARD_OSES) {
        const key = keyFor(kb, os);
        if (key === undefined) continue;
        const oses = byKey.get(key);
        if (oses === undefined) byKey.set(key, [os]);
        else oses.push(os);
    }
    return [...byKey].map(([key, oses]) => ({
        key,
        when: oses.length === KEYBOARD_OSES.length ? undefined : oses.map((os) => `os == '${os}'`).join(" || "),
    }));
}

function rulesOf(kb: IKeybindingContribution): IKeybindingLayerRule[] {
    return variantsOf(kb).map((variant) => {
        const chord = parseChord(variant.key);
        // `-command` снимает ровно эту комбинацию — условие ОС не нужно.
        if (kb.command.startsWith("-")) return { command: kb.command, chord };
        return { command: kb.command, chord, when: combineWhen(variant.when, kb.when) };
    });
}
