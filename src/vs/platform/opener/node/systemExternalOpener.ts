import { type ChildProcess, spawn } from "node:child_process";

import type { IExternalOpener } from "../common/iExternalOpener.ts";

/**
 * Сколько ждём открывателя, прежде чем считать ссылку отданной. `xdg-open`/`open`
 * отдают адрес и выходят сразу; зависший процесс (нет ни браузера, ни ошибки) —
 * повод не держать расширение дольше.
 */
const OPENER_TIMEOUT_MS = 3000;

/** Адрес со схемой, и не похожий на флаг: `-…` открыватель принял бы за опцию. */
const SCHEMED_TARGET = /^[a-z][a-z0-9+.-]*:/i;

/** Как запускается открыватель по умолчанию — подменяется в тестах. */
export type SpawnOpener = (command: string, args: readonly string[]) => ChildProcess;

/**
 * Запуск открывателя по умолчанию: отдельной функцией, а не стрелкой в дефолте
 * параметра, — чтобы production-путь можно было позвать в тесте.
 *
 * `detached` + `stdio: "ignore"`: терминал общий с редактором, и печать
 * открывателя в кадр недопустима (правило «stdout ребёнку закрыт»).
 */
// Stryker disable next-line BooleanLiteral: `detached` наблюдаемого следа в тесте не оставляет (группа процессов), а смысл его в том, чтобы открыватель не держал редактор
export const spawnOpenerProcess: SpawnOpener = (command, args) =>
    spawn(command, [...args], { detached: true, stdio: "ignore" });

export interface ISystemExternalOpenerEnvironment {
    readonly platform: NodeJS.Platform;
    readonly env: NodeJS.ProcessEnv;
    readonly spawnOpener?: SpawnOpener;
}

/**
 * Открыватель ссылок через системный механизм (`xdg-open` / `open` /
 * `cmd /c start`). Не композит: если открывать некому, он честно отвечает
 * `false` — показать ссылку человеку умеет
 * {@link import("../../../workbench/services/opener/browser/openerService.ts").OpenerService}
 * поверх него.
 *
 * Открывать НЕ пытаемся там, где браузер вылез бы не у того человека или не
 * вылез бы вовсе:
 * - сессия по ssh (`SSH_CONNECTION`) — окно открылось бы на сервере;
 * - Linux/BSD без `DISPLAY`/`WAYLAND_DISPLAY` — графической сессии нет.
 * В обоих случаях запуск не «не удался», а бессмыслен: `xdg-open` вернул бы 0,
 * и мы бы соврали, что человек увидел ссылку.
 */
export class SystemExternalOpener implements IExternalOpener {
    private readonly platform: NodeJS.Platform;
    private readonly env: NodeJS.ProcessEnv;
    private readonly spawnOpener: SpawnOpener;

    public constructor(environment: ISystemExternalOpenerEnvironment) {
        this.platform = environment.platform;
        this.env = environment.env;
        this.spawnOpener = environment.spawnOpener ?? spawnOpenerProcess;
    }

    /** Есть ли куда открывать (см. описание класса). */
    public canOpen(): boolean {
        if (this.env.SSH_CONNECTION !== undefined) return false;
        if (this.platform === "darwin" || this.platform === "win32") return true;
        return this.env.DISPLAY !== undefined || this.env.WAYLAND_DISPLAY !== undefined;
    }

    public async openExternal(target: string): Promise<boolean> {
        if (!SCHEMED_TARGET.test(target)) return false;
        if (!this.canOpen()) return false;
        const [command, ...args] = openerCommand(this.platform);
        try {
            return await this.run(command, [...args, target]);
        } catch {
            // spawn кинул синхронно (нет прав, битый PATH) — ссылка не ушла.
            return false;
        }
    }

    /**
     * Запускает открыватель и ждёт его исхода. `error` на ChildProcess слушаем
     * ОБЯЗАТЕЛЬНО: необработанное событие EventEmitter'а — это исключение, то есть
     * смерть редактора из-за отсутствующего `xdg-open` (docs/ARCHITECTURE.md).
     */
    private run(command: string, args: readonly string[]): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const child = this.spawnOpener(command, args);
            let settled = false;
            const settle = (opened: boolean): void => {
                // Stryker disable next-line ConditionalExpression,BooleanLiteral,CallExpression: защёлка ненаблюдаема через промис — второй `resolve` он игнорирует сам, а повторный `clearTimeout` безвреден. Держим её, чтобы не гонять лишнюю работу на каждом событии ребёнка
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(opened);
            };
            // Дожидаться выхода до конца незачем: открыватель уже отдал адрес
            // системе, а держать обещание расширения — нет.
            const timer = setTimeout(() => {
                settle(true);
            }, OPENER_TIMEOUT_MS);
            // Stryker disable next-line CallExpression: unref не меняет исход обещания, он лишь не даёт таймеру держать event loop живым — наблюдаемо только в момент выхода процесса
            timer.unref();
            child.once("error", () => {
                settle(false);
            });
            child.once("exit", (code) => {
                settle(code === 0);
            });
            // Не держим наш event loop за руку: открыватель живёт своей жизнью.
            child.unref();
        });
    }
}

/** Команда открывателя платформы. `start` у Windows требует пустого «заголовка». */
function openerCommand(platform: NodeJS.Platform): readonly string[] {
    if (platform === "darwin") return ["open"];
    if (platform === "win32") return ["cmd", "/c", "start", ""];
    return ["xdg-open"];
}
