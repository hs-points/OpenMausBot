// Start-up recovery of chat follow-ups a restart cut mid-dispatch: each one's words come back once, with a review notice.
import { noticeTool } from "../chat-notices.ts";
import { isContextMessage, recordHanded } from "../delta-context.ts";
import { sinceFreshStart } from "../fresh-start.ts";
import { spokenLineFields } from "../live-call-record.ts";
import { chatFollowups, settleChatFollowups } from "../message-db.ts";
import type { Store } from "../store.ts";

export function recoverInterruptedFollowups({ store }: { store: Store }): void {
  for (const row of chatFollowups()) {
    if (row.kind === "aside") { settleChatFollowups([row.id], null); continue; }
    if (row.status !== "dispatching" && row.status !== "interrupted") continue;
    const owned = row.kind === "channel"
      ? Boolean(store.groupByThread(row.threadId)?.id === row.ownerId)
      : Boolean(store.taskByThread(row.ownerId, row.threadId));
    if (!owned) { settleChatFollowups([row.id], "cancelled"); continue; }
    settleChatFollowups([row.id], "interrupted");
    const messages = store.messagesFor(row.threadId);
    const recovered = messages.find((message) => message.queueId === row.id && message.role === "user") ?? store.appendMessage(row.threadId, {
      role: "user", kind: "text", text: row.payload.text, replyToId: row.payload.replyToId,
      sendId: row.payload.sendId, queueId: row.id, sender: row.payload.sender,
      ...(row.kind === "channel" ? { channelMode: row.payload.mode, via: row.payload.via } : {}),
      ...(row.kind === "bot" ? spokenLineFields(row.payload.via, row.payload.callId) : {}),
    });
    const recoveredTask = row.kind !== "channel" ? store.taskByThread(row.ownerId, row.threadId) : undefined;
    const order = sinceFreshStart(store.activePath(row.threadId)).filter(isContextMessage).map((m) => m.id);
    for (const [instanceId, state] of Object.entries(recoveredTask?.handedMessages ?? {})) {
      if (state.session !== undefined) store.setHandedMessages(row.ownerId, row.threadId, instanceId, recordHanded(state, order, [recovered.id]));
    }
    if (!messages.some((message) => message.queueId === row.id && message.kind === "activity")) {
      store.appendMessage(row.threadId, {
        role: "bot", kind: "activity", queueId: row.id,
        tool: noticeTool("chat.notice.followupInterrupted", undefined, { ok: false }),
      });
    }
    settleChatFollowups([row.id], null);
  }
}
