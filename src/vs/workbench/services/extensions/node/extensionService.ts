import { mark } from "../../../../base/common/performance.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IExtensionService } from "../common/extensions.ts";

import type { IExtensionRegistrationEnv } from "./extensionRegistration.ts";
import { toExtensionRegistration } from "./extensionRegistration.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/**
 * Сколько `onStartupFinished` ждёт eager-активацию (`*` и `workspaceContains:`),
 * прежде чем наступить без неё (`timeout(10000)` эталона).
 */
export const STARTUP_FINISHED_TIMEOUT_MS = 10_000;

/** Механика extension host'а, которой распоряжается сервис (`ExtensionHost`). */
export interface IExtensionActivationHost {
    registerExtension(reg: IExtensionRegistration): unknown;
    /** Установленное расширение без кода: регистрации нет, но зависимость на него удовлетворена. */
    registerDeclarativeExtension(id: string): void;
    activateByEvent(event: string): Promise<void>;
    activateByWorkspaceContains(): Promise<void>;
}

/**
 * Сервис расширений окна: регистрирует набор в extension host'е и ведёт
 * стартовую активацию (см. {@link IExtensionService}).
 *
 * Барьер и память событий (как `_allRequestedActivateEvents` у vscode): событие,
 * пришедшее до {@link start} (файл открылся раньше регистрации), не теряется, а
 * проигрывается сразу за `*`. Поэтому порядок «регистрация строго после
 * openFile + ручной `onLanguage:` активного редактора» больше не нужен.
 */
export class ExtensionService implements IExtensionService {
    /** События, запрошенные до барьера, — в порядке прихода, без повторов. */
    private readonly requested: string[] = [];
    private barrierOpen = false;
    private openBarrier!: () => void;
    private readonly barrier = new Promise<void>((resolve) => {
        this.openBarrier = resolve;
    });

    public constructor(
        private readonly host: IExtensionActivationHost,
        public readonly extensions: readonly IExtension[],
        private readonly registrationEnv: IExtensionRegistrationEnv,
        private readonly logger: ILogger,
        private readonly startupFinishedTimeoutMs = STARTUP_FINISHED_TIMEOUT_MS,
    ) {}

    public getExtension(id: string): IExtension | undefined {
        return this.extensions.find((ext) => ext.id === id);
    }

    public whenInstalledExtensionsRegistered(): Promise<void> {
        return this.barrier;
    }

    public activateByEvent(event: string): Promise<void> {
        if (this.barrierOpen) return this.host.activateByEvent(event);
        if (!this.requested.includes(event)) this.requested.push(event);
        return this.barrier;
    }

    public activateByWorkspaceContains(): Promise<void> {
        // До барьера проход по папкам сделает сам старт — последним из событий.
        if (this.barrierOpen) return this.host.activateByWorkspaceContains();
        return this.barrier;
    }

    /**
     * Регистрация набора и стартовая активация (как `_handleEagerExtensions`
     * эталона): `*` (за ним — события, запрошенные до регистрации, и барьер) и
     * проход `workspaceContains:` идут параллельно; `onStartupFinished` — после
     * них, но не позже {@link STARTUP_FINISHED_TIMEOUT_MS}: повисший `activate()`
     * одного eager-расширения не откладывает его навсегда.
     *
     * Сбой регистрации одного расширения — в лог, остальные регистрируются;
     * сбой самого host'а (субпроцесс не поднялся) — в лог, редактор работает без
     * расширений. Барьер открывается в любом случае: ждущие не повиснут.
     */
    public async start(): Promise<void> {
        for (const ext of this.extensions) {
            try {
                const reg = await toExtensionRegistration(ext, this.registrationEnv);
                // Без `main` регистрации нет, но хосту надо знать, что расширение
                // установлено: `extensionDependencies` на него удовлетворены.
                if (reg === null) this.host.registerDeclarativeExtension(ext.id);
                else this.host.registerExtension(reg);
            } catch (err) {
                this.logger.error(`${ext.id}: failed to register${ext.isBuiltin ? " (builtin)" : ""}`, err);
            }
        }
        mark("main:extensions-registered");
        const eager = Promise.all([
            this.activateEager(),
            this.guard("workspaceContains", this.host.activateByWorkspaceContains()),
        ]);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, this.startupFinishedTimeoutMs);
        });
        await Promise.race([eager, timeout]);
        clearTimeout(timer);
        await this.guard("onStartupFinished", this.host.activateByEvent("onStartupFinished"));
        await eager;
        mark("exthost:activated");
    }

    /** `*`, за ним — события, запрошенные до регистрации; затем барьер. */
    private async activateEager(): Promise<void> {
        await this.guard("*", this.host.activateByEvent("*"));
        // Живой обход: событие, пришедшее во время проигрыша, тоже проиграется.
        for (const event of this.requested) await this.guard(event, this.host.activateByEvent(event));
        this.barrierOpen = true;
        this.openBarrier();
    }

    /** Сбой host'а на стартовом событии — в лог, а не в отказ всего старта. */
    private async guard(event: string, activation: Promise<void>): Promise<void> {
        try {
            await activation;
        } catch (err) {
            this.logger.error(`extension host activation failed (${event})`, err);
        }
    }
}
