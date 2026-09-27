import { spawn } from "node:child_process";

import type { IClipboard } from "../../../../platform/clipboard/common/iClipboard.ts";
import type { IExternalOpener } from "../common/iExternalOpener.ts";

/** Окружение и швы, от которых зависит выбор способа открыть ссылку. */
export interface IExternalOpenerEnvironment {
    readonly platform: NodeJS.Platform;
    /** Переменные окружения процесса — по ним видно, есть ли графический сеанс. */
    readonly env: Readonly<Partial<Record<string, string>>>;
    /** Запуск системного обработчика; `false` — запустить не удалось. */
    readonly launch: (command: string, args: readonly string[]) => Promise<boolean>;
    /** Буфер обмена: туда уезжает URL, когда открыть его нечем. */
    readonly clipboard: IClipboard;
    /**
     * Показ сообщения человеку. Колбэком, а не сервисом: поверхность сообщений
     * живёт в `browser`, а этот сервис — в `node` (ему нужен `child_process`), и
     * импорт `node → browser` запрещён правилами слоёв. Проводку делает module.
     */
    readonly showInfo: (message: string) => void;
}

/** Схемы, которые мы вообще берёмся открывать (остальное — не наше дело). */
const OPENABLE_SCHEMES = ["http:", "https:", "mailto:"];

/**
 * Открыватель внешних ссылок: пробует системный обработчик, а там, где его нет,
 * ОТДАЁТ ССЫЛКУ ЧЕЛОВЕКУ — кладёт в буфер обмена и показывает сообщением.
 *
 * Второй путь здесь не «заглушка на всякий случай», а основной сценарий Diode:
 * редактор живёт в терминале, и запускать браузер на другом конце ssh нечем.
 * Молча возвращать `false` нельзя — расширение показало бы «не удалось», а
 * человек так и не узнал бы, куда его вели (типовой случай — регистрация
 * AI-автодополнения по ссылке).
 *
 * Системный обработчик — `xdg-open` (Linux), `open` (macOS), `cmd /c start`
 * (Windows). На Linux он запускается только при живом графическом сеансе:
 * `DISPLAY`/`WAYLAND_DISPLAY` есть и это не ssh-сессия. Иначе `xdg-open`
 * либо ничего не сделает, либо откроет ссылку в текстовом браузере ПОВЕРХ
 * нашего терминала — то есть сломает интерфейс редактора.
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

    /**
     * Отдаёт ссылку человеку: URL в буфер обмена (системный через OSC 52 плюс
     * внутренний регистр) и сообщение с самим URL — его видно и можно выделить
     * мышью, даже если буфер до терминала не доехал.
     */
    private async handOver(url: string): Promise<boolean> {
        await this.environment.clipboard.writeText(url);
        this.environment.showInfo(`Ссылка скопирована в буфер обмена: ${url}`);
        return true;
    }
}

/** Схема ссылки нам знакома и URL вообще разбирается? */
export function isOpenableUrl(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    return OPENABLE_SCHEMES.includes(parsed.protocol);
}

/** Системный обработчик для этого окружения; `null` — открывать нечем. */
export function systemHandler(
    environment: Pick<IExternalOpenerEnvironment, "platform" | "env">,
): { readonly command: string; readonly args: readonly string[] } | null {
    if (environment.platform === "darwin") return { command: "open", args: [] };
    if (environment.platform === "win32") return { command: "cmd", args: ["/c", "start", ""] };
    if (!hasGraphicalSession(environment.env)) return null;
    return { command: "xdg-open", args: [] };
}

/**
 * Есть ли графический сеанс, в который можно отдать ссылку. Проверяем оба
 * дисплея (X11 и Wayland) и отсекаем ssh: там `DISPLAY` бывает проброшен, но
 * открывать браузер на дальнем конце туннеля — не то, чего человек ждёт.
 */
export function hasGraphicalSession(env: Readonly<Partial<Record<string, string>>>): boolean {
    if (nonEmpty(env.SSH_CONNECTION) || nonEmpty(env.SSH_TTY)) return false;
    return nonEmpty(env.DISPLAY) || nonEmpty(env.WAYLAND_DISPLAY);
}

function nonEmpty(value: string | undefined): boolean {
    return value !== undefined && value !== "";
}

/**
 * Как запускается системный обработчик. Оба поля — про наш терминал: `stdio:
 * "ignore"` не даёт браузеру писать в кадр TUI (его вывод затёр бы интерфейс), а
 * `detached` отвязывает его от нашего процесса — он живёт дольше редактора.
 */
export const HANDLER_SPAWN_OPTIONS = { detached: true, stdio: "ignore" } as const;

/**
 * Запуск системного обработчика отдельным процессом — по правилам
 * {@link HANDLER_SPAWN_OPTIONS}.
 */
export function spawnDetached(command: string, args: readonly string[]): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (ok: boolean): void => {
            if (settled) return;
            settled = true;
            resolve(ok);
        };
        try {
            const child = spawn(command, [...args], HANDLER_SPAWN_OPTIONS);
            // `error` слушать ОБЯЗАТЕЛЬНО: без слушателя ENOENT (обработчика нет
            // в PATH) уходит в unhandled и роняет процесс редактора.
            child.on("error", () => {
                settle(false);
            });
            child.on("spawn", () => {
                child.unref();
                settle(true);
            });
        } catch {
            settle(false);
        }
    });
}
