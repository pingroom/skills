import type { PingRoom } from "@pingroom/sdk";

/** What a PingRoom Question carries so we can map its answer back to OpenClaw. */
export interface QuestionMarker {
  plugin: "openclaw";
  kind: "question" | "approval";
  /** ask_user question id (kind "question"). */
  questionId?: string;
  /** Durable approval id (kind "approval"). */
  approvalId?: string;
  approvalKind?: string;
  room?: string;
  sessionKey?: string;
  agentId?: string;
  binding?: string;
}

export interface TrackedQuestion {
  pingroomQuestionId: string;
  marker: QuestionMarker;
}

export interface QuestionResolution {
  marker: QuestionMarker;
  state: "answered" | "expired" | "cancelled";
  /** The chosen option value, when the human tapped one. */
  optionValue?: string;
  /** A typed answer, when they used the free-text path instead. */
  text?: string;
  responderId?: string;
  targetUserId?: string;
  responderScope?: string;
}

export function isOpenClawMarker(value: unknown): value is QuestionMarker {
  const marker = (value as { oc?: QuestionMarker })?.oc ?? (value as QuestionMarker);
  return typeof marker === "object" && marker !== null && (marker as QuestionMarker).plugin === "openclaw";
}

export function readMarker(data: unknown): QuestionMarker | null {
  const marker = (data as { oc?: unknown })?.oc;
  return isOpenClawMarker(marker) ? (marker as QuestionMarker) : null;
}

/**
 * Turn a resolved PingRoom Question into the OpenClaw-side outcome.
 *
 * A question the human let expire is NOT an answer, and a typed reply is not an
 * option — both are distinguished here so the caller resolves the gateway the
 * right way instead of inventing a choice.
 */
export function readResolution(question: {
  state?: string;
  answer?: { value?: string | null; text?: string | null; responder?: { id?: string | null } | null } | null;
  data?: unknown;
  target_user_id?: string | null;
  responder_scope?: string;
}): QuestionResolution | null {
  const marker = readMarker(question?.data);
  if (!marker) return null;

  const state = question.state;
  if (state !== "answered" && state !== "expired" && state !== "cancelled") return null;

  if (state !== "answered") return { marker, state };

  const value = question.answer?.value ?? undefined;
  const text = question.answer?.text ?? undefined;
  return {
    marker,
    state,
    ...(typeof value === "string" && value !== "" ? { optionValue: value } : {}),
    ...(typeof text === "string" && text !== "" ? { text } : {}),
    ...(question.answer?.responder?.id ? { responderId: question.answer.responder.id } : {}),
    ...(question.target_user_id ? { targetUserId: question.target_user_id } : {}),
    ...(question.responder_scope ? { responderScope: question.responder_scope } : {}),
  };
}

/**
 * Re-adopt the questions this plugin created before a restart.
 *
 * The mapping lives on the Question itself (`data.oc`), so there is no local
 * store to lose: whatever is still pending on the server is authoritative.
 */
export async function adoptPendingQuestions(sdk: PingRoom): Promise<TrackedQuestion[]> {
  const listed = (await sdk.questions.list({ state: "pending" } as never)) as
    | { questions?: Array<{ id?: string; data?: unknown }> }
    | Array<{ id?: string; data?: unknown }>;
  const rows = Array.isArray(listed) ? listed : listed?.questions ?? [];
  const adopted: TrackedQuestion[] = [];
  for (const row of rows) {
    const marker = readMarker(row?.data);
    if (marker && typeof row.id === "string") {
      adopted.push({ pingroomQuestionId: row.id, marker });
    }
  }
  return adopted;
}
