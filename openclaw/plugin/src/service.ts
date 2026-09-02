import type { PingRoom } from "@pingroom/sdk";
import { createClient, isQuotaExhausted } from "./client.js";
import type { ResolvedAccount } from "./config.js";
import { dedupeKey, isConversational, type PingRoomEvent } from "./inbound/events.js";
import { adoptPendingQuestions, readResolution, type QuestionMarker } from "./inbound/questions.js";

export interface ServiceDeps {
  account: ResolvedAccount;
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void; debug?: (m: string) => void };
  /** Deliver an inbound Ping into an agent session. */
  onPing: (event: Extract<PingRoomEvent, { type: "ping" }>) => Promise<void>;
  /** Resolve an ask_user question or an approval on the gateway. */
  onQuestionResolved: (resolution: {
    marker: QuestionMarker;
    state: "answered" | "expired" | "cancelled";
    optionValue?: string;
    text?: string;
    responderId?: string;
  }) => Promise<void>;
  /** Tell the session that a human acknowledged a Ping. */
  onAck?: (notificationId: string) => Promise<void>;
  setStatus?: (status: { lifecycle: "connected" | "degraded"; lastError?: string }) => void;
  sdk?: PingRoom;
}

/**
 * Everything this account runs while the gateway is up: the inbound poller and
 * the open-question watchers, sharing one abort signal and one dedupe set.
 */
export class PingRoomAccountService {
  private readonly controller = new AbortController();
  private readonly seen = new Map<string, number>();
  private readonly watching = new Set<string>();
  private readonly sdk: PingRoom;
  private started = false;

  constructor(private readonly deps: ServiceDeps) {
    this.sdk = deps.sdk ?? createClient(deps.account);
  }

  get signal(): AbortSignal { return this.controller.signal; }
  get client(): PingRoom { return this.sdk; }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Whatever was open before a restart is still open on the server; the
    // mapping rides on the Question, so re-adopting needs no local state.
    try {
      for (const tracked of await adoptPendingQuestions(this.sdk)) {
        this.watchQuestion(tracked.pingroomQuestionId);
      }
    } catch (error) {
      this.deps.log.warn(`could not re-adopt open questions: ${describe(error)}`);
    }

    if (this.deps.account.inboundEnabled) void this.pollLoop();
    this.deps.setStatus?.({ lifecycle: "connected" });
  }

  async stop(): Promise<void> {
    this.controller.abort();
  }

  /** Watch one Question this plugin created until it reaches a terminal state. */
  watchQuestion(questionId: string): void {
    if (this.watching.has(questionId) || this.signal.aborted) return;
    this.watching.add(questionId);
    void (async () => {
      try {
        const resolved = (await this.sdk.questions.waitForAnswer(questionId, {
          signal: this.signal,
        } as never)) as Parameters<typeof readResolution>[0];
        const resolution = readResolution(resolved);
        if (!resolution) return;
        await this.handle({
          type: "question.resolved",
          id: questionId,
          questionId,
          state: resolution.state,
        }, () => this.deps.onQuestionResolved(resolution));
      } catch (error) {
        if (!this.signal.aborted) {
          this.deps.log.warn(`question ${questionId} watch ended: ${describe(error)}`);
        }
      } finally {
        this.watching.delete(questionId);
      }
    })();
  }

  /** Feed an event that arrived by webhook through the same path as a polled one. */
  async ingest(event: PingRoomEvent): Promise<void> {
    if (event.type === "ping") {
      await this.handle(event, () => this.deps.onPing(event));
      return;
    }
    if (event.type === "notification.acked") {
      await this.handle(event, async () => { await this.deps.onAck?.(event.notificationId); });
      return;
    }
    if (event.type === "question.resolved") {
      // The webhook says a question ended but not how; the record is
      // authoritative, so read it rather than trusting the event body.
      try {
        const question = (await this.sdk.questions.get(event.questionId)) as Parameters<typeof readResolution>[0];
        const resolution = readResolution(question);
        if (resolution) await this.handle(event, () => this.deps.onQuestionResolved(resolution));
      } catch (error) {
        this.deps.log.warn(`could not read question ${event.questionId}: ${describe(error)}`);
      }
    }
  }

  /** Run `work` at most once per distinct event, whichever transport delivered it. */
  private async handle(event: PingRoomEvent, work: () => Promise<void>): Promise<void> {
    const key = dedupeKey(event);
    const now = Date.now();
    // Bounded, time-based: a gateway that runs for months must not grow a set
    // of every notification id it ever saw.
    for (const [seenKey, at] of this.seen) {
      if (now - at > SEEN_TTL_MS) this.seen.delete(seenKey);
    }
    if (this.seen.has(key)) return;
    this.seen.set(key, now);
    try {
      await work();
    } catch (error) {
      this.seen.delete(key);
      this.deps.log.error(`handling ${key} failed: ${describe(error)}`);
    }
  }

  private async pollLoop(): Promise<void> {
    let backoffMs = 1000;
    while (!this.signal.aborted) {
      try {
        const result = (await this.sdk.notifications.wait({
          timeout: this.deps.account.pollTimeoutSeconds,
          ...(this.cursor ? { after: this.cursor } : {}),
          signal: this.signal,
        } as never)) as { notifications?: unknown[]; cursor?: string };

        backoffMs = 1000;
        this.deps.setStatus?.({ lifecycle: "connected" });
        if (typeof result?.cursor === "string") this.cursor = result.cursor;

        for (const raw of result?.notifications ?? []) {
          const notification = raw as Parameters<typeof isConversational>[0];
          if (!isConversational(notification)) continue;
          await this.handle(
            { type: "ping", id: notification.id, notification },
            () => this.deps.onPing({ type: "ping", id: notification.id, notification }),
          );
        }
      } catch (error) {
        if (this.signal.aborted) return;
        const message = describe(error);
        this.deps.setStatus?.({ lifecycle: "degraded", lastError: message });
        if (isQuotaExhausted(error)) {
          this.deps.log.warn("PingRoom free daily quota reached; sends will fail until it resets");
        } else {
          this.deps.log.warn(`inbound poll failed, retrying in ${Math.round(backoffMs / 1000)}s: ${message}`);
        }
        await sleep(backoffMs, this.signal);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
  }

  private cursor: string | undefined;
}

const SEEN_TTL_MS = 24 * 60 * 60 * 1000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
