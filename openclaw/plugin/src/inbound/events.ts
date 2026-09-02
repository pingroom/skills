/**
 * The one shape everything inbound is normalized into, whether it arrived by
 * long-poll or by signed webhook, so both transports share one handler and one
 * dedupe key.
 */
export type PingRoomEvent =
  | { type: "ping"; id: string; notification: InboundNotification }
  | { type: "question.resolved"; id: string; questionId: string; state: string }
  | { type: "notification.acked"; id: string; notificationId: string; ackedBy?: string }
  | { type: "notification.expired"; id: string; notificationId: string };

export interface InboundNotification {
  id: string;
  message?: string | null;
  notification_title?: string | null;
  trigger_source?: string | null;
  is_handoff?: boolean;
  question?: unknown;
  origin_agent?: unknown;
  data?: Record<string, unknown> | null;
  attachments?: Array<{ filename?: string }> | null;
  sender?: { id?: string; name?: string | null } | null;
  room?: { code?: string; name?: string | null } | null;
  created_at?: string;
}

/**
 * Trigger sources that are this platform talking to itself, not a person
 * talking to the agent. Delivering these into a session would make the agent
 * respond to its own Pings.
 */
const MACHINE_TRIGGER_SOURCES = new Set([
  "agent",
  "agent_question",
  "agent_approval",
  "agent_live",
  "user_live",
  "system",
  "self_test",
  "test",
]);

/**
 * Should this notification become a message in an agent session?
 *
 * `notifications.wait` already excludes the bound human's own sends, so what
 * arrives here is other room members — plus anything this agent itself created,
 * which `origin_agent` identifies and we drop rather than echo.
 */
export function isConversational(notification: InboundNotification): boolean {
  if (notification.origin_agent) return false;
  if (notification.question) return false;
  if (notification.is_handoff) return false;
  const source = notification.trigger_source ?? "manual";
  if (MACHINE_TRIGGER_SOURCES.has(source)) return false;
  return true;
}

/** The text an agent should see for an inbound Ping. */
export function renderInboundText(notification: InboundNotification): string {
  const parts: string[] = [];
  const title = notification.notification_title?.trim();
  const message = notification.message?.trim();
  if (title && message) parts.push(`${title}: ${message}`);
  else if (title) parts.push(title);
  else if (message) parts.push(message);

  const data = notification.data ?? {};
  const url = typeof data.url === "string" ? data.url : undefined;
  if (url) parts.push(`(link: ${url})`);

  const location = data.location as { label?: string; latitude?: number; longitude?: number } | undefined;
  if (location && typeof location.latitude === "number" && typeof location.longitude === "number") {
    const label = typeof location.label === "string" ? `${location.label} ` : "";
    parts.push(`(location: ${label}${location.latitude},${location.longitude})`);
  }

  const names = (notification.attachments ?? [])
    .map((a) => a?.filename)
    .filter((n): n is string => typeof n === "string" && n !== "");
  if (names.length > 0) parts.push(`(attached: ${names.join(", ")})`);

  return parts.join(" ").trim() || "(empty ping)";
}

/** Stable per-event identity, so poll and webhook delivery of the same fact collapse. */
export function dedupeKey(event: PingRoomEvent): string {
  switch (event.type) {
    case "ping": return `ping:${event.id}`;
    case "question.resolved": return `question:${event.questionId}:${event.state}`;
    case "notification.acked": return `acked:${event.notificationId}`;
    case "notification.expired": return `expired:${event.notificationId}`;
  }
}

/** Normalize an outgoing-webhook body into the same union the poller produces. */
export function fromWebhook(body: Record<string, unknown>): PingRoomEvent | null {
  const name = typeof body.event === "string" ? body.event : "";
  const notificationId = typeof body.notification_id === "string" ? body.notification_id : "";

  if (name === "ping" && notificationId) {
    return {
      type: "ping",
      id: notificationId,
      notification: {
        id: notificationId,
        message: typeof body.body === "string" ? body.body : null,
        notification_title: typeof body.title === "string" ? body.title : null,
        trigger_source: typeof body.trigger_source === "string" ? body.trigger_source : null,
        data: (body.data as Record<string, unknown>) ?? null,
        sender: typeof body.sender === "string" ? { name: body.sender } : null,
        room: (body.room as { code?: string; name?: string }) ?? null,
      },
    };
  }
  if (name.startsWith("question.")) {
    const questionId = typeof body.question_id === "string"
      ? body.question_id
      : typeof (body.question as { id?: string })?.id === "string"
        ? (body.question as { id: string }).id
        : "";
    if (!questionId) return null;
    return { type: "question.resolved", id: questionId, questionId, state: name.slice("question.".length) };
  }
  if (name === "notification.acked" && notificationId) {
    return { type: "notification.acked", id: notificationId, notificationId };
  }
  if (name === "notification.expired" && notificationId) {
    return { type: "notification.expired", id: notificationId, notificationId };
  }
  return null;
}
