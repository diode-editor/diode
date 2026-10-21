// Editor policy, not a tuidom primitive: the engine doesn't know the threshold, the editor passes it as a parameter.

/**
 * Mirrors upstream `editor.stopRenderingLineAfter` (same default), in code units. A separate
 * knob from the tokenization `MAX_LINE_LENGTH`, as in upstream.
 */
export const STOP_RENDERING_LINE_AFTER = 10_000;

/** The width is part of a truncated line's `contentWidth`, otherwise horizontal scroll can't reach the badge. All chars are width 1. */
export const LONG_LINE_TRUNCATION_BADGE = " Long line trimmed ";
export const LONG_LINE_TRUNCATION_BADGE_WIDTH = LONG_LINE_TRUNCATION_BADGE.length;
