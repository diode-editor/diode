import { combineWhen } from "../../../../platform/actions/common/commandAction.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IKeybindingContribution } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import { type KeybindingRegistry, parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

/** ОС клавиатуры, как её называет контекст-ключ `os`. */
type KeyboardOs = "mac" | "linux" | "windows";

const KEYBOARD_OSES: readonly KeyboardOs[] = ["mac", "linux", "windows"];

/**
 * Регистрирует `contributes.keybindings` расширений в {@link KeybindingRegistry}.
 *
 * `key` (или платформенный оверрайд `mac`/`linux`/`win`) парсится как аккорд
 * (`parseChord`), `when` прокидывается как when-выражение. Платформу выбирает
 * не `process.platform`, а контекст-ключ `os` — ОС клавиатуры: по ssh с мака
 * нужна `mac`-ветка, а сам ответ может уточниться уже после старта (XTVERSION,
 * tmux). Поэтому различающиеся варианты регистрируются все, каждый со своим
 * условием `os == …`, и активный выбирается при резолве.
 *
 * Команда с ведущим `-` (`"-editor.action.foo"`) снимает привязку, как в VS Code.
 * Порядок важен: extension-биндинги регистрируются ПОСЛЕ builtin — резолвер идёт
 * с конца, так что расширение переопределяет встроенную привязку того же аккорда
 * (VS Code parity). Команда сама по себе резолвится через `CommandRegistry`
 * (builtin action либо прокси extension-команды из ExtensionHost).
 */
export function registerExtensionKeybindings(
    extensions: readonly IExtension[],
    keybindingRegistry: KeybindingRegistry,
    logger?: ILogger,
): void {
    for (const ext of extensions) {
        const keybindings = ext.manifest.contributes?.keybindings;
        if (keybindings === undefined) continue;
        for (const kb of keybindings) {
            try {
                applyKeybinding(kb, keybindingRegistry);
            } catch (err) {
                logger?.warn(`${ext.id}: не удалось применить keybinding "${kb.key}" → ${kb.command}`, err);
            }
        }
    }
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

function applyKeybinding(kb: IKeybindingContribution, registry: KeybindingRegistry): void {
    for (const variant of variantsOf(kb)) {
        const chord = parseChord(variant.key);
        // Ведущий `-` в command — снятие привязки (VS Code `-command`).
        if (kb.command.startsWith("-")) {
            registry.removeBindings(kb.command.slice(1), chord);
            continue;
        }
        registry.register(chord, kb.command, combineWhen(variant.when, kb.when), "extension");
    }
}
