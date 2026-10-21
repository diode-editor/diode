import { mark } from "../../../../base/common/performance.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IExtensionService } from "../common/extensions.ts";

import type { IExtensionRegistrationEnv } from "./extensionRegistration.ts";
import { toExtensionRegistration } from "./extensionRegistration.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/** `timeout(10000)` эталона: столько `onStartupFinished` ждёт eager-активацию. */
export const STARTUP_FINISHED_TIMEOUT_MS = 10_000;

export interface IExtensionActivationHost {
    registerExtension(reg: IExtensionRegistration): unknown;
    /** Установленное расширение без кода: регистрации нет, но зависимость на него удовлетворена. */
    registerDeclarativeExtension(id: string): void;
    activateByEvent(event: string): Promise<void>;
    activateByWorkspaceContains(): Promise<void>;
    restartForWorkspaceChange(): Promise<void>;
}

/** Событие, пришедшее до {@link start}, не теряется, а проигрывается сразу за `*` (как `_allRequestedActivateEvents` эталона). */
export class ExtensionService implements IExtensionService {
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

    public restartForWorkspaceChange(): Promise<void> {
        // До барьера ни регистраций, ни процесса: проход по папкам сделает сам
        // старт — последним из событий, уже по новому воркспейсу.
        if (this.barrierOpen) return this.host.restartForWorkspaceChange();
        return this.barrier;
    }

    /**
     * Как `_handleEagerExtensions` эталона: `*` и `workspaceContains:` параллельно, `onStartupFinished` —
     * после них, но не позже {@link STARTUP_FINISHED_TIMEOUT_MS}: повисший `activate()` не откладывает
     * его навсегда. Барьер открывается при любом сбое — ждущие не повиснут.
     */
    public async start(): Promise<void> {
        for (const ext of this.extensions) {
            try {
                const reg = await toExtensionRegistration(ext, this.registrationEnv);
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

    private async activateEager(): Promise<void> {
        await this.guard("*", this.host.activateByEvent("*"));
        // Живой обход: событие, пришедшее во время проигрыша, тоже проиграется.
        for (const event of this.requested) await this.guard(event, this.host.activateByEvent(event));
        this.barrierOpen = true;
        this.openBarrier();
    }

    private async guard(event: string, activation: Promise<void>): Promise<void> {
        try {
            await activation;
        } catch (err) {
            this.logger.error(`extension host activation failed (${event})`, err);
        }
    }
}
