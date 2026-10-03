import { mark } from "../../../../base/common/performance.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IExtensionService } from "../common/extensions.ts";

import type { IExtensionRegistrationEnv } from "./extensionRegistration.ts";
import { toExtensionRegistration } from "./extensionRegistration.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/** Механика extension host'а, которой распоряжается сервис (`ExtensionHost`). */
export interface IExtensionActivationHost {
    registerExtension(reg: IExtensionRegistration): unknown;
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
        private readonly logger?: ILogger,
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
     * Регистрация набора и стартовая активация: `*` → события, запрошенные до
     * регистрации (`onLanguage:` уже открытых файлов) → барьер →
     * `onStartupFinished` → `workspaceContains:` (последним: единственное событие,
     * которому нужен обход дерева, и держать на нём соседей незачем).
     *
     * Сбой регистрации одного расширения — в лог, остальные регистрируются;
     * сбой самого host'а (субпроцесс не поднялся) — в лог, редактор работает без
     * расширений. Барьер открывается в любом случае: ждущие не повиснут.
     */
    public async start(): Promise<void> {
        for (const ext of this.extensions) {
            try {
                const reg = await toExtensionRegistration(ext, this.registrationEnv);
                if (reg !== null) this.host.registerExtension(reg);
            } catch (err) {
                this.logger?.error(`${ext.id}: failed to register${ext.isBuiltin ? " (builtin)" : ""}`, err);
            }
        }
        mark("main:extensions-registered");
        try {
            await this.host.activateByEvent("*");
            // Живой обход: событие, пришедшее во время проигрыша, тоже проиграется.
            for (const event of this.requested) await this.host.activateByEvent(event);
            this.barrierOpen = true;
            this.openBarrier();
            await this.host.activateByEvent("onStartupFinished");
            await this.host.activateByWorkspaceContains();
        } catch (err) {
            this.logger?.error("extension host activation failed", err);
        }
        this.barrierOpen = true;
        this.openBarrier();
        mark("exthost:activated");
    }
}
