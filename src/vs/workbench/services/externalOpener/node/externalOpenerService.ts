import { spawn } from "node:child_process";

import type { IClipboard } from "../../../../platform/clipboard/common/iClipboard.ts";
import type { IExternalOpener } from "../common/iExternalOpener.ts";

export interface IExternalOpenerEnvironment {
    readonly platform: NodeJS.Platform;
    readonly env: Readonly<Partial<Record<string, string>>>;
    /** `false` — запустить не удалось. */
    readonly launch: (command: string, args: readonly string[]) => Promise<boolean>;
    readonly clipboard: IClipboard;
    /** Колбэком, а не сервисом: поверхность сообщений — в `browser`, а `node → browser` запрещён. */
    readonly showInfo: (message: string) => void;
}

const OPENABLE_SCHEMES = ["http:", "https:", "mailto:"];

/**
 * Там, где системного обработчика нет, ссылка отдаётся человеку (буфер + сообщение) — это
 * основной сценарий: редактор в терминале, браузер на другом конце ssh не запустить, а
 * молчаливый `false` оставил бы человека без ссылки (регистрация AI-автодополнения).
 * На Linux `xdg-open` — только при живом графическом сеансе: иначе он откроет текстовый
 * браузер поверх нашего терминала.
 */
export class ExternalOpenerService implements IExternalOpener {
    public constructor(private readonly environment: IExternalOpenerEnvironment) {}

    public async open(url: string): Promise<boolean> {
        if (!isOpenableUrl(url)) return false;
        const handler = systemHandler(this.environment);
        if (handler !== null && (await this.environment.launch(handler.command, [...handler.args, url]))) {
            return true;
        }
        return this.handOver(url);
    }

    /** Сообщение с самим URL — его можно выделить мышью, даже если буфер до терминала не доехал. */
    private async handOver(url: string): Promise<boolean> {
        await this.environment.clipboard.writeText(url);
        this.environment.showInfo(`Ссылка скопирована в буфер обмена: ${url}`);
        return true;
    }
}

export function isOpenableUrl(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    return OPENABLE_SCHEMES.includes(parsed.protocol);
}

export function systemHandler(
    environment: Pick<IExternalOpenerEnvironment, "platform" | "env">,
): { readonly command: string; readonly args: readonly string[] } | null {
    if (environment.platform === "darwin") return { command: "open", args: [] };
    if (environment.platform === "win32") return { command: "cmd", args: ["/c", "start", ""] };
    if (!hasGraphicalSession(environment.env)) return null;
    return { command: "xdg-open", args: [] };
}

/** `DISPLAY` по ssh бывает проброшен, но открывать браузер на дальнем конце туннеля — не то, чего ждут. */
export function hasGraphicalSession(env: Readonly<Partial<Record<string, string>>>): boolean {
    if (nonEmpty(env.SSH_CONNECTION) || nonEmpty(env.SSH_TTY)) return false;
    return nonEmpty(env.DISPLAY) || nonEmpty(env.WAYLAND_DISPLAY);
}

function nonEmpty(value: string | undefined): boolean {
    return value !== undefined && value !== "";
}

/** `stdio: "ignore"` — вывод браузера затёр бы кадр TUI; `detached` — он живёт дольше редактора. */
export const HANDLER_SPAWN_OPTIONS = { detached: true, stdio: "ignore" } as const;

export function spawnDetached(command: string, args: readonly string[]): Promise<boolean> {
    return new Promise<boolean>((settle) => {
        // Своего флага «уже ответили» не держим: `resolve` промиса идемпотентен,
        // и второй вызов (например `error` после `spawn`) спецификация игнорирует.
        try {
            const child = spawn(command, [...args], HANDLER_SPAWN_OPTIONS);
            // `error` слушать ОБЯЗАТЕЛЬНО: без слушателя ENOENT (обработчика нет
            // в PATH) уходит в unhandled и роняет процесс редактора.
            child.on("error", () => {
                settle(false);
            });
            child.on("spawn", () => {
                // Stryker disable next-line CallExpression: unref снимает удержание нашего выхода дочерним процессом — внутри процесса тестов это ненаблюдаемо
                child.unref();
                settle(true);
            });
        } catch {
            settle(false);
        }
    });
}
