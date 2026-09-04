import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { QuestionMarker } from "./questions.js";

/** Bind server-stored question metadata to this gateway and paired credential. */
export class QuestionBindings {
  private readonly key: Buffer;
  constructor(home: string) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const path = join(home, "question-binding.key");
    try {
      writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    this.key = readFileSync(path);
    if (this.key.length !== 32) throw new Error("Invalid PingRoom question binding key");
  }

  sign(marker: QuestionMarker, token: string): QuestionMarker {
    return { ...marker, binding: this.digest(marker, token) };
  }

  verify(marker: QuestionMarker, token: string): boolean {
    if (typeof marker.binding !== "string" || !/^[a-f0-9]{64}$/.test(marker.binding)) return false;
    return timingSafeEqual(Buffer.from(marker.binding, "hex"), Buffer.from(this.digest(marker, token), "hex"));
  }

  private digest(marker: QuestionMarker, token: string): string {
    return createHmac("sha256", this.key).update(JSON.stringify([
      token, marker.kind, marker.questionId, marker.approvalId, marker.approvalKind,
      marker.room, marker.sessionKey, marker.agentId,
    ])).digest("hex");
  }
}
