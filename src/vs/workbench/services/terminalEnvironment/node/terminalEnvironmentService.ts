import type { ITerminalBackend } from "@tuidom/core/backend/iTerminalBackend";
import { NodeTerminalBackend } from "@tuidom/terminal-backend/nodeTerminalBackend";
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
} from "./terminalEnvironmentModel.ts";
import { queryTmuxClient, type TmuxClientInfo } from "./tmuxClientProbe.ts";

export const TerminalEnvironmentServiceDIToken = token<TerminalEnvironmentService>("TerminalEnvironmentService");

/**
 * The keyboard protocols (Kitty push + modifyOtherKeys) are on from startup only by an explicit
 * setting: `terminal.tier` `csi-u`/`kitty`, or `auto` with `terminal.capabilities["extended-keys"]: true`.
 * `main.ts` asks this before creating the backend; the answer holds for the whole session.
 */
export function extendedKeysAtStartup(config: IConfigurationService): boolean {
    return protocolsRequested(config.get("terminal.tier"), capabilityOverrides(config));
}

/** The configuration service already replaced an out-of-enum tier with the default ("auto"). */
type TierSetting = "auto" | Tier;
type CapabilityOverrides = Partial<Record<Capability, unknown>>;

function protocolsRequested(tier: TierSetting, overrides: CapabilityOverrides): boolean {
    if (tier === "csi-u" || tier === "kitty") return true;
    return tier === "auto" && overrides["extended-keys"] === true;
}

/** Turns the keyboard protocols on in the real terminal; headless and mock backends have none to switch. */
export function extendedKeysSwitch(backend: ITerminalBackend): () => void {
    return () => {
        if (backend instanceof NodeTerminalBackend) backend.enableExtendedKeys();
    };
}

function capabilityOverrides(config: IConfigurationService): CapabilityOverrides {
    return config.get<CapabilityOverrides>("terminal.capabilities") ?? {};
}

/**
 * The tier is fixed at construction and does not change during the session (#1049): the
 * same keys in kitty, tmux and ssh. The one exception is a Mac keyboard outside tmux with
 * `auto`: once the terminal answers the `CSI ? u` probe, the Kitty protocol is turned on
 * for Cmd ({@link detect}). Otherwise the probes only learn what is *available*
 * ({@link availableTier}) for the status bar. Config can force any value.
 */
export class TerminalEnvironmentService extends Disposable {
    public static dependencies = [TerminalBackendDIToken, IConfigurationServiceDIToken] as const;

    private readonly backend: ITerminalBackend;

    private capabilities: CapabilitySet = emptyCapabilities();
    /** Settings read once: the protocols are not switched mid-session. */
    private readonly tierSetting: TierSetting;
    private readonly overrides: CapabilityOverrides;
    private osSignals: OsSignals;
    private resolvedOs: ResolvedOs;

    private readonly baseModes: ReadonlySet<string>;
    /** Wins over baseModes. */
    private readonly forcedModes = new Map<string, boolean>();
    private readonly customModeNames: string[];

    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    private probeStarted = false;
    private tmuxQueried = false;
    private available: Tier | undefined;

    public constructor(
        backend: ITerminalBackend,
        config: IConfigurationService,
        private readonly queryTmux: () => Promise<TmuxClientInfo> = queryTmuxClient,
        private readonly enableExtendedKeys: () => void = extendedKeysSwitch(backend),
    ) {
        super();
        this.backend = backend;
        this.tierSetting = config.get("terminal.tier");
        this.overrides = capabilityOverrides(config);
        this.baseModes = detectBaseModes();
        this.osSignals = initialOsSignals(config.get("keyboard.platform"));
        this.resolvedOs = resolveOs(this.osSignals);

        this.capabilities.truecolor = detectTruecolor();
        this.capabilities["kitty-graphics"] = detectKittyGraphicsHint();
        this.capabilities["mouse-sgr"] = true; // backend enables SGR mouse unconditionally
        // OSC52 is usually available, but default tmux blocks it unless `set-clipboard on`.
        this.capabilities.osc52 = !this.baseModes.has("tmux");

        const forced = config.get<Record<string, boolean>>("terminal.modes");
        if (forced) {
            for (const [name, on] of Object.entries(forced)) this.forcedModes.set(name, on);
        }
        const custom = config.get<Record<string, unknown>>("terminal.customModes");
        this.customModeNames = custom ? Object.keys(custom) : [];

        this.applyCapabilityOverrides();
        this.capabilities["extended-keys"] = protocolsRequested(this.tierSetting, this.overrides);
    }

    /**
     * The tier the terminal could do while the protocols are off: `kitty` once a terminal outside
     * tmux answered `CSI ? u`, `csi-u` when tmux passes extended keys. `undefined` — nothing to offer.
     */
    public get availableTier(): Tier | undefined {
        return this.available;
    }

    public get tier(): Tier {
        return this.tierSetting === "auto" ? resolveTier(this.capabilities) : this.tierSetting;
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
     * Fires the probes nothing waits on; not under tmux: XTVERSION would be answered by tmux itself
     * ({@link detectTmuxClient} provides the name) and `CSI ? u` not at all.
     */
    public detect(): void {
        if (this.probeStarted || this.baseModes.has("tmux")) return;
        this.probeStarted = true;
        this.backend.probeTerminalVersion((name) => {
            this.noteTerminalName(name);
        });
        // XTVERSION goes first and replies come in order, so a Mac terminal name is known by now.
        this.backend.probeKeyboardProtocol((supported) => {
            if (!supported) return;
            if (this.capabilities["extended-keys"]) this.noteCmdReachable();
            else if (this.isMacException()) this.enableForMac();
            else this.noteAvailable("kitty");
        });
    }

    /** `auto`, a Mac keyboard and no explicit word on extended keys. */
    private isMacException(): boolean {
        return this.tierSetting === "auto" && this.os === "mac" && this.overrides["extended-keys"] === undefined;
    }

    private enableForMac(): void {
        this.enableExtendedKeys();
        this.capabilities["extended-keys"] = true;
        this.noteCmdReachable();
    }

    /** The Kitty protocol is on outside tmux: Cmd gets through unless the config says otherwise. */
    private noteCmdReachable(): void {
        const forced = this.overrides.super;
        this.capabilities.super = typeof forced === "boolean" ? forced : true;
        this.emitChange();
    }

    private noteAvailable(tier: Tier): void {
        this.available = tier;
        this.emitChange();
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
            if (info.extendedKeys && !this.capabilities["extended-keys"]) this.noteAvailable("csi-u");
        });
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
        for (const [cap, on] of Object.entries(this.overrides)) {
            if (cap in this.capabilities && typeof on === "boolean") {
                this.capabilities[cap as Capability] = on;
            }
        }
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
