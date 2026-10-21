import { token } from "../../instantiation/common/diContainer.ts";

export const ModifierReleaseArmoryDIToken = token<ModifierReleaseArmory>("ModifierReleaseArmory");

export interface CommandTrigger {
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
}

/** The modifier whose release ends the series. Shift is excluded: in `mod+shift+key` it sets the direction. */
export function holdModifierOf(trigger: CommandTrigger): string | undefined {
    if (trigger.ctrlKey) return "Control";
    if (trigger.altKey) return "Alt";
    if (trigger.metaKey) return "Meta";
    return undefined;
}

/**
 * "Hold the modifier to cycle, release to commit" (tab MRU). The chord resolver doesn't see
 * holds, hence the separate mechanism. The modifier comes from the trigger, so rebinding to
 * Alt+Tab doesn't break it; the trigger is call context rather than an argument, so it doesn't
 * clash with command arguments.
 */
export class ModifierReleaseArmory {
    private pending: { modifier: string; commit: () => void; generation: number } | null = null;
    private currentTrigger: CommandTrigger | undefined;
    /** Grows on every arm; {@link commitStaleAfter} uses it to tell a NEW arm from an old one. */
    private generationCounter = 0;

    /** Nested calls restore the previous context. */
    public withTrigger(trigger: CommandTrigger, run: () => void): void {
        const previous = this.currentTrigger;
        this.currentTrigger = trigger;
        try {
            run();
        } finally {
            this.currentTrigger = previous;
        }
    }

    /** No-op without a held modifier (menu, command palette): there is nothing to release. */
    public armOnHoldRelease(commit: () => void): void {
        const modifier = this.currentTrigger !== undefined ? holdModifierOf(this.currentTrigger) : undefined;
        if (modifier !== undefined) this.arm(modifier, commit);
    }

    /** Overwrites the previous arm. */
    public arm(modifier: string, commit: () => void): void {
        // Stryker disable next-line UpdateOperator: the arm number only matters as "same / different", the counting direction has no observable effect
        this.pending = { modifier, commit, generation: ++this.generationCounter };
    }

    public fireRelease(modifier: string): void {
        if (this.pending?.modifier !== modifier) return;
        const { commit } = this.pending;
        this.pending = null;
        commit();
    }

    /** Read BEFORE handling a keypress, to compare later in {@link commitStaleAfter}. */
    public get pendingGeneration(): number | null {
        return this.pending?.generation ?? null;
    }

    /**
     * Fallback end of a hold session where the modifier keyup never arrives (a legacy terminal without
     * kitty event types): commits an arm the keypress didn't extend. Repeating the series chord
     * re-arms the session, so the cycle isn't broken by this.
     */
    public commitStaleAfter(generationBefore: number | null): void {
        // `null` (nothing was armed at keypress time) is filtered by the same
        // comparison: a live arm number is a number and never equals null.
        if (this.pending?.generation !== generationBefore) return;
        const { commit } = this.pending;
        this.pending = null;
        commit();
    }
}
