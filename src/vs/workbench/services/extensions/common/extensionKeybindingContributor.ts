import { combineWhen } from "../../../../platform/actions/common/commandAction.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IKeybindingContribution } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import {
    type IKeybindingLayerRule,
    type KeybindingRegistry,
    parseChord,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

/** ОС клавиатуры, как её называет контекст-ключ `os`. */
type KeyboardOs = "mac" | "linux" | "windows";

const KEYBOARD_OSES: readonly KeyboardOs[] = ["mac", "linux", "windows"];

/**
 * Собирает `contributes.keybindings` всех расширений в слой extension
 * {@link KeybindingRegistry} (`setExtensionKeybindings` — слой заменяется целиком).
 *
 * `key` (или платформенный оверрайд `mac`/`linux`/`win`) парсится как аккорд
 * (`parseChord`), `when` прокидывается как when-выражение. Платформу выбирает
 * не `process.platform`, а контекст-ключ `os` — ОС клавиатуры: по ssh с мака
 * нужна `mac`-ветка, а сам ответ может уточниться уже после старта (XTVERSION,
 * tmux). Поэтому различающиеся варианты регистрируются все, каждый со своим
 * условием `os == …`, и активный выбирается при резолве.
 *
 * Команда с ведущим `-` (`"-editor.action.foo"`) снимает привязку из слоёв
 * default и extension, как в VS Code; user-бинды не трогает. Бинд расширения
 * сильнее встроенного на той же комбинации, а пользовательский — сильнее бинда
 * расширения: приоритет задают слои реестра, а не момент вызова. Команда сама по
 * себе резолвится через `CommandRegistry` (builtin action либо прокси
 * extension-команды из ExtensionHost).
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

/** Привязка для ОС `os`: платформенный оверрайд поверх кросс-платформенного `key`. */
function keyFor(kb: IKeybindingContribution, os: KeyboardOs): string | undefined {
    const override = os === "mac" ? kb.mac : os === "windows" ? kb.win : kb.linux;
    const key = override ?? kb.key;
    return typeof key === "string" && key.trim() !== "" ? key : undefined;
}

/**
 * Варианты привязки, сгруппированные по совпадающему ключу: `key → ОС`, где он
 * действует. Один вариант на все три ОС — условие по `os` не нужно.
 */
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

/** Правила слоя по одному `contributes.keybindings[]`: вариант на каждую различающуюся ОС. */
function rulesOf(kb: IKeybindingContribution): IKeybindingLayerRule[] {
    return variantsOf(kb).map((variant) => {
        const chord = parseChord(variant.key);
        // Ведущий `-` в command — снятие привязки (VS Code `-command`); условие ОС
        // у снятия не нужно — снимается ровно эта комбинация.
        if (kb.command.startsWith("-")) return { command: kb.command, chord };
        return { command: kb.command, chord, when: combineWhen(variant.when, kb.when) };
    });
}
