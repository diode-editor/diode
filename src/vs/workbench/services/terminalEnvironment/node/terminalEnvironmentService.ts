import type { ITerminalBackend } from "@tuidom/core/backend/iTerminalBackend";
import { isInsideTmux, isSsh } from "@tuidom/terminal-backend/terminalEnv";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { MacKeysRung } from "../../../../platform/keybinding/common/macKeys.ts";
import { TerminalBackendDIToken } from "../../../../platform/terminal/common/terminalBackendDIToken.ts";

import {
    canUpgradeToMac,
    type Capability,
    type CapabilitySet,
    detectBaseModes,
    detectExtendedKeysHint,
    detectKittyGraphicsHint,
    detectTruecolor,
    emptyCapabilities,
    type OsName,
    type OsSignals,
    type OsSource,
    type ResolvedOs,
    resolveMacKeysRung,
    resolveOs,
    resolveTier,
    type Tier,
    TIER_ORDER,
} from "./terminalEnvironmentModel.ts";
import { queryTmuxClient, type TmuxClientInfo } from "./tmuxClientProbe.ts";

export const TerminalEnvironmentServiceDIToken = token<TerminalEnvironmentService>("TerminalEnvironmentService");

/**
 * Detection is synchronous at construction (env vars), so startup never blocks; `detect()`
 * then fires a keyboard-protocol probe nothing waits on. Config can force any value.
 */
export class TerminalEnvironmentService extends Disposable {
    public static dependencies = [TerminalBackendDIToken, IConfigurationServiceDIToken] as const;

    private readonly backend: ITerminalBackend;
    private readonly config: IConfigurationService;

    private capabilities: CapabilitySet = emptyCapabilities();
    private tierValue: Tier = "legacy";
    private osSignals: OsSignals;
    private resolvedOs: ResolvedOs;

    private readonly baseModes: ReadonlySet<string>;
    /** Wins over baseModes. */
    private readonly forcedModes = new Map<string, boolean>();
    private readonly customModeNames: string[];

    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    private probeStarted = false;
    private tmuxQueried = false;

    public constructor(
        backend: ITerminalBackend,
        config: IConfigurationService,
        private readonly queryTmux: () => Promise<TmuxClientInfo> = queryTmuxClient,
    ) {
        super();
        this.backend = backend;
        this.config = config;
        this.baseModes = detectBaseModes();
        this.osSignals = initialOsSignals(this.config.get("keyboard.platform"));
        this.resolvedOs = resolveOs(this.osSignals);

        this.capabilities["extended-keys"] = detectExtendedKeysHint();
        this.capabilities.truecolor = detectTruecolor();
        this.capabilities["kitty-graphics"] = detectKittyGraphicsHint();
        this.capabilities["mouse-sgr"] = true; // backend enables SGR mouse unconditionally
        // OSC52 is usually available, but default tmux blocks it unless `set-clipboard on`.
        this.capabilities.osc52 = !this.baseModes.has("tmux");

        const forced = this.config.get<Record<string, boolean>>("terminal.modes");
        if (forced) {
            for (const [name, on] of Object.entries(forced)) this.forcedModes.set(name, on);
        }
        const custom = this.config.get<Record<string, unknown>>("terminal.customModes");
        this.customModeNames = custom ? Object.keys(custom) : [];

        this.applyCapabilityOverrides();
        this.tierValue = this.resolveTierWithOverride();
    }

    public get tier(): Tier {
        return this.tierValue;
    }

    /** The keyboard's OS (not the process's) — see {@link resolveOs}. */
    public get os(): OsName {
        return this.resolvedOs.os;
    }

    public get osSource(): OsSource {
        return this.resolvedOs.source;
    }

    /** `$TERM_PROGRAM`, only outside tmux: inside it is "tmux". */
    public get terminalName(): string | undefined {
        const env = process.env;
        const own = this.baseModes.has("tmux") ? undefined : env.TERM_PROGRAM;
        return this.osSignals.terminalName ?? this.osSignals.lcTerminal ?? (own === "" ? undefined : own);
    }

    public get macKeysRung(): MacKeysRung | undefined {
        return resolveMacKeysRung(this.os, this.capabilities, this.getActiveModes());
    }

    public hasCapability(cap: Capability): boolean {
        return this.capabilities[cap];
    }

    public isModeActive(name: string): boolean {
        const forced = this.forcedModes.get(name);
        if (forced !== undefined) return forced;
        return this.baseModes.has(name);
    }

    public getActiveModes(): ReadonlySet<string> {
        const active = new Set<string>(this.baseModes);
        for (const [name, on] of this.forcedModes) {
            if (on) active.add(name);
            else active.delete(name);
        }
        return active;
    }

    public getKnownModeNames(): readonly string[] {
        return [...new Set<string>(["local", "ssh", "tmux", ...this.forcedModes.keys(), ...this.customModeNames])];
    }

    /**
     * The probe only upgrades: a non-reply over a slow link must not lose an env-detected
     * capability. Under tmux XTVERSION is not sent — tmux itself would reply; {@link detectTmuxClient} provides the name.
     */
    public detect(): void {
        if (this.probeStarted) return;
        this.probeStarted = true;
        if (!this.baseModes.has("tmux")) {
            this.backend.probeTerminalVersion((name) => {
                this.noteTerminalName(name);
            });
        }
        this.backend.probeKeyboardProtocol((supported) => {
            if (!supported || this.capabilities["extended-keys"]) return; // upgrade-only, skip no-op
            this.capabilities["extended-keys"] = true;
            this.applyCapabilityOverrides(); // a config-forced value still wins
            const tier = this.resolveTierWithOverride();
            if (tier === this.tierValue) return;
            this.tierValue = tier;
            this.emitChange();
        });
    }

    /**
     * Separate from {@link detect}: the query spawns `tmux`, whose synchronous part costs ~20 ms,
     * so startup calls this after the first frame (`startWorkbench`). Idempotent.
     */
    public detectTmuxClient(): void {
        if (this.tmuxQueried || !this.baseModes.has("tmux")) return;
        this.tmuxQueried = true;
        void this.queryTmux().then((info) => {
            this.noteOsSignals({ envPlatform: info.envPlatform, lcTerminal: info.lcTerminal });
            this.noteTerminalName(info.termType);
        });
    }

    /**
     * The only reliable signal behind tmux, which masks $TERM and drops the `CSI ? u` probe:
     * a key arriving in CSI-u form proves support. Upgrade-only, like {@link detect}.
     */
    public noteExtendedKeysObserved(): void {
        if (this.capabilities["extended-keys"]) return;
        this.capabilities["extended-keys"] = true;
        this.applyCapabilityOverrides(); // a config-forced value still wins
        const tier = this.resolveTierWithOverride();
        if (tier === this.tierValue) return;
        this.tierValue = tier;
        this.emitChange();
    }

    /** Seeing super also proves extended keys (only the Kitty protocol encodes it). Upgrade-only. */
    public noteSuperObserved(): void {
        const rungBefore = this.macKeysRung;
        const tierBefore = this.tierValue;
        this.capabilities.super = true;
        this.capabilities["extended-keys"] = true;
        this.applyCapabilityOverrides(); // a config-forced value still wins
        this.tierValue = this.resolveTierWithOverride();
        if (this.macKeysRung === rungBefore && this.tierValue === tierBefore) return;
        this.emitChange();
    }

    /** Flips the OS only towards mac and never over an explicit answer (see {@link canUpgradeToMac}). */
    public noteTerminalName(name: string | undefined): void {
        this.noteOsSignals({ terminalName: name });
    }

    /** Late signals extend the startup ones; a missing signal does not erase a known one. */
    private noteOsSignals(update: Pick<OsSignals, "envPlatform" | "lcTerminal" | "terminalName">): void {
        this.osSignals = {
            ...this.osSignals,
            envPlatform: update.envPlatform ?? this.osSignals.envPlatform,
            lcTerminal: update.lcTerminal ?? this.osSignals.lcTerminal,
            terminalName: update.terminalName ?? this.osSignals.terminalName,
        };
        const next = resolveOs(this.osSignals);
        if (!canUpgradeToMac(this.resolvedOs, next)) return;
        this.resolvedOs = next;
        this.emitChange();
    }

    private applyCapabilityOverrides(): void {
        const overrides = this.config.get<Partial<Record<Capability, boolean>>>("terminal.capabilities");
        if (!overrides) return;
        for (const [cap, on] of Object.entries(overrides)) {
            if (cap in this.capabilities && typeof on === "boolean") {
                this.capabilities[cap as Capability] = on;
            }
        }
    }

    private resolveTierWithOverride(): Tier {
        // The configuration service already replaced an out-of-enum value with the default ("auto").
        const forced = this.config.get("terminal.tier");
        if (forced !== "auto") return forced;
        return resolveTier(this.capabilities);
    }

    public setMode(name: string, active: boolean): void {
        if (this.forcedModes.get(name) === active) return;
        this.forcedModes.set(name, active);
        this.emitChange();
    }

    public readonly onDidChange = this.onDidChangeEmitter.event;

    private emitChange(): void {
        this.onDidChangeEmitter.fire();
    }
}

/**
 * Synchronous OS signals at startup. Under tmux our own `process.env` is not read: it is frozen
 * at session creation — live values arrive later from tmux itself (see `detect`).
 */
function initialOsSignals(setting: string | undefined, env: NodeJS.ProcessEnv = process.env): OsSignals {
    const tmux = isInsideTmux(env);
    return {
        setting,
        envPlatform: tmux ? undefined : env.LC_DIODE_PLATFORM,
        lcTerminal: tmux ? undefined : env.LC_TERMINAL,
        platform: process.platform,
        ssh: isSsh(env),
    };
}
