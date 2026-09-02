import {
  QUESTION_CONTEXT_MAX,
  QUESTION_MAX_OPTIONS,
  QUESTION_MIN_OPTIONS,
  QUESTION_OPTION_LABEL_MAX,
  QUESTION_OPTION_VALUE_MAX,
} from "../constants.js";

/**
 * What the channel decided to send for one outbound payload.
 *
 * Computed from the portable `presentation` OpenClaw hands every channel, and
 * stashed on the payload so the send path does not re-derive it.
 */
export type PingPlan =
  | { kind: "text" }
  | { kind: "link"; url: string; buttonLabel?: string }
  | {
      kind: "question";
      questionId: string;
      prompt: string;
      context?: string;
      allowText: boolean;
      options: PingPlanOption[];
    }
  | {
      kind: "approval";
      approvalId: string;
      approvalKind: string;
      prompt: string;
      context?: string;
      options: PingPlanOption[];
    };

export interface PingPlanOption {
  value: string;
  label: string;
  style?: "primary" | "danger";
}

interface PresentationButton {
  label?: unknown;
  style?: unknown;
  action?: unknown;
}

interface PresentationBlock {
  type?: unknown;
  text?: unknown;
  buttons?: unknown;
}

export interface Presentation {
  title?: unknown;
  blocks?: unknown;
}

/**
 * Classify a presentation into the PingRoom primitive that carries it.
 *
 * Only two shapes become something tappable on a phone: a set of buttons that
 * all resolve one `ask_user` question, and a set that all resolve one approval.
 * Anything else — a callback, a slash command, a select, a mix — falls back to
 * plain text. That is deliberate: `callback` values are opaque plugin data and
 * OpenClaw's contract forbids reinterpreting them, and a PingRoom Question can
 * only carry one question with 2–4 options, so a mixed block has no faithful
 * representation.
 */
export function planFromPresentation(presentation: Presentation | null | undefined): PingPlan {
  if (!presentation || !Array.isArray(presentation.blocks)) return { kind: "text" };

  const blocks = presentation.blocks as PresentationBlock[];
  const buttons: PresentationButton[] = [];
  for (const block of blocks) {
    if (block?.type === "buttons" && Array.isArray(block.buttons)) {
      buttons.push(...(block.buttons as PresentationButton[]));
    }
    // A select cannot be rendered as a Question: PingRoom options are buttons,
    // and silently flattening a picker would misrepresent the choice.
    if (block?.type === "select") return { kind: "text" };
  }
  if (buttons.length === 0) return { kind: "text" };

  const prompt = textOf(presentation.title) ?? firstTextBlock(blocks) ?? "A decision is waiting";
  const context = clamp(firstContextBlock(blocks), QUESTION_CONTEXT_MAX);

  const questionIds = new Set<string>();
  const approvals = new Set<string>();
  const approvalKinds = new Set<string>();
  const options: PingPlanOption[] = [];
  let allowText = false;
  let linkUrl: string | undefined;
  let linkLabel: string | undefined;

  for (const button of buttons) {
    const action = button?.action as Record<string, unknown> | undefined;
    const label = textOf(button?.label);
    if (!action || typeof action.type !== "string") return { kind: "text" };

    switch (action.type) {
      case "question": {
        if (typeof action.questionId !== "string") return { kind: "text" };
        questionIds.add(action.questionId);
        if (action.intent === "custom-input") { allowText = true; break; }
        if (typeof action.optionValue !== "string" || !label) return { kind: "text" };
        options.push({
          value: clamp(action.optionValue, QUESTION_OPTION_VALUE_MAX)!,
          label: clamp(label, QUESTION_OPTION_LABEL_MAX)!,
          ...styleOf(button?.style),
        });
        break;
      }
      case "approval": {
        if (typeof action.approvalId !== "string" || typeof action.decision !== "string") {
          return { kind: "text" };
        }
        approvals.add(action.approvalId);
        if (typeof action.approvalKind === "string") approvalKinds.add(action.approvalKind);
        options.push({
          value: clamp(action.decision, QUESTION_OPTION_VALUE_MAX)!,
          label: clamp(label ?? action.decision, QUESTION_OPTION_LABEL_MAX)!,
          ...styleOf(button?.style, action.decision === "deny" ? "danger" : undefined),
        });
        break;
      }
      case "url": {
        if (typeof action.url !== "string") return { kind: "text" };
        // More than one link has no single-button representation.
        if (linkUrl) return { kind: "text" };
        linkUrl = action.url;
        linkLabel = label ?? undefined;
        break;
      }
      default:
        // command / callback / model-picker: not ours to reinterpret.
        return { kind: "text" };
    }
  }

  if (linkUrl && options.length === 0 && questionIds.size === 0 && approvals.size === 0) {
    return { kind: "link", url: linkUrl, ...(linkLabel ? { buttonLabel: linkLabel } : {}) };
  }
  // A link mixed with a decision would lose one of the two.
  if (linkUrl) return { kind: "text" };

  if (questionIds.size === 1 && approvals.size === 0 && usable(options)) {
    return {
      kind: "question",
      questionId: [...questionIds][0],
      prompt,
      ...(context ? { context } : {}),
      allowText,
      options: options.slice(0, QUESTION_MAX_OPTIONS),
    };
  }

  if (approvals.size === 1 && questionIds.size === 0 && usable(options)) {
    return {
      kind: "approval",
      approvalId: [...approvals][0],
      approvalKind: approvalKinds.size === 1 ? [...approvalKinds][0] : "exec",
      prompt,
      ...(context ? { context } : {}),
      options: options.slice(0, QUESTION_MAX_OPTIONS),
    };
  }

  return { kind: "text" };
}

function usable(options: PingPlanOption[]): boolean {
  const values = new Set(options.map((o) => o.value));
  return options.length >= QUESTION_MIN_OPTIONS && values.size === options.length;
}

function styleOf(style: unknown, fallback?: "danger"): { style?: "primary" | "danger" } {
  if (style === "primary" || style === "success") return { style: "primary" };
  if (style === "danger") return { style: "danger" };
  return fallback ? { style: fallback } : {};
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function firstTextBlock(blocks: PresentationBlock[]): string | undefined {
  return textOf(blocks.find((b) => b?.type === "text")?.text);
}

function firstContextBlock(blocks: PresentationBlock[]): string | undefined {
  return textOf(blocks.find((b) => b?.type === "context")?.text);
}

function clamp(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
