import type { ITerminalBackend } from "@tuidom/all/backend/iTerminalBackend";
import { Disposable, type IDisposable } from "@tuidom/all/common/disposable";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { TerminalBackendDIToken } from "../../../common/coreTokens.ts";

import {
    type Capability,
    type CapabilitySet,
    detectBaseModes,
    detectExtendedKeysHint,
    detectKittyGraphicsHint,
    detectTruecolor,
    emptyCapabilities,
    type OsName,
    resolveOs,
    resolveTier,
    type Tier,
    TIER_ORDER,
} from "./terminalEnvironmentModel.ts";

export const TerminalEnvironmentServiceDIToken = token<TerminalEnvironmentService>("TerminalEnvironmentService");

/**
 * Detects the terminal environment (capabilities → tier, modes, OS) and exposes
 * it for context-key wiring + the status bar.
 *
 * Detection is **synchronous** at construction (env vars: $TERM/$COLORTERM/$TMUX/$SSH/…),
 * so tier/modes are correct immediately and startup never blocks. `detect()` then kicks
 * off a **fire-and-forget** keyboard-protocol probe (encapsulated by the backend) that can
 * only *upgrade* `extended-keys` — useful inside tmux/ssh where $TERM is masked. When the
 * probe lands it fires `onDidChange`; nothing ever waits on it. Config can force any value.
 */
export class TerminalEnvironmentService extends Disposable {
    public static dependencies = [TerminalBackendDIToken, IConfigurationServiceDIToken] as const;

    private readonly backend: ITerminalBackend;
    private readonly config: IConfigurationService;

    private capabilities: CapabilitySet = emptyCapabilities();
    private tierValue: Tier = "legacy";
    private readonly osValue: OsName;

    /** Predicate-detected modes (local/ssh/tmux). */
    private readonly baseModes: ReadonlySet<string>;
    /** Manual/config force overrides: name → on/off. Wins over baseModes. */
    private readonly forcedModes = new Map<string, boolean>();
    /** Declared custom mode names (manual-only) — surfaced for context-key registration. */
    private readonly customModeNames: string[];

    private readonly listeners = new Set<() => void>();
    private probeStarted = false;

    public constructor(backend: ITerminalBackend, config: IConfigurationService) {
        super();
        this.backend = backend;
        this.config = config;
        this.osValue = resolveOs(process.platform);
        this.baseModes = detectBaseModes();

        // Synchronous capability detection from environment (no terminal round-trip).
        this.capabilities["extended-keys"] = detectExtendedKeysHint();
        this.capabilities.truecolor = detectTruecolor();
        this.capabilities["kitty-graphics"] = detectKittyGraphicsHint();
        this.capabilities["mouse-sgr"] = true; // backend enables SGR mouse unconditionally
        // OSC52 is usually available, but default tmux blocks it unless `set-clipboard on`.
        this.capabilities.osc52 = !this.baseModes.has("tmux");

        // Config: forced modes + declared custom modes.
        const forced = this.config.get<Record<string, boolean>>("terminal.modes");
        if (forced) {
            for (const [name, on] of Object.entries(forced)) this.forcedModes.set(name, on);
        }
        const custom = this.config.get<Record<string, unknown>>("terminal.customModes");
        this.customModeNames = custom ? Object.keys(custom) : [];

        // Apply capability/tier config overrides and resolve the tier — all synchronous.
        this.applyCapabilityOverrides();
        this.tierValue = this.resolveTierWithOverride();
    }

    // ─── Public snapshot ───

    public get tier(): Tier {
        return this.tierValue;
    }

    public get os(): OsName {
        return this.osValue;
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

    /** All mode names known to the service — for context-key registration. */
    public getKnownModeNames(): readonly string[] {
        return [...new Set<string>(["local", "ssh", "tmux", ...this.forcedModes.keys(), ...this.customModeNames])];
    }

    // ─── Detection ───

    /**
     * Kicks off the fire-and-forget keyboard-protocol probe. Returns immediately; if the
     * terminal confirms support, `extended-keys` is upgraded and `onDidChange` fires. The
     * probe never downgrades (a non-reply over a slow link must not lose an env-detected
     * capability), and a config-forced capability/tier always wins.
     */
    public detect(): void {
        if (this.probeStarted) return;
        this.probeStarted = true;
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
     * Upgrade `extended-keys` from observed input — call when the app actually received a
     * Kitty/CSI-u-encoded key. This is the only reliable signal behind tmux, which masks $TERM
     * and silently drops the `CSI ? u` capability probe: the probe can't confirm support, but a
     * key arriving in CSI-u form proves it. Upgrade-only and idempotent, like {@link detect};
     * a config-forced value still wins. Fires `onDidChange` if the tier actually changes.
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
        const forced = this.config.get<string>("terminal.tier");
        if (forced && forced !== "auto" && (TIER_ORDER as readonly string[]).includes(forced)) {
            return forced as Tier;
        }
        return resolveTier(this.capabilities);
    }

    // ─── Runtime mode toggle ───

    public setMode(name: string, active: boolean): void {
        if (this.forcedModes.get(name) === active) return;
        this.forcedModes.set(name, active);
        this.emitChange();
    }

    // ─── Change notification ───

    public onDidChange(listener: () => void): IDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    private emitChange(): void {
        for (const listener of [...this.listeners]) listener();
    }

    public override dispose(): void {
        this.listeners.clear();
        super.dispose();
    }
}
