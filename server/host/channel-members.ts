// A channel's roster as a request names it: known, distinct bots, at least one of them active.
import type { Store } from "../store.ts";

export function createChannelMembers({ store }: { store: Pick<Store, "bot"> }) {
  return { checkedMemberIds };

  function checkedMemberIds(value: unknown): { ok: true; memberIds: string[] } | { ok: false; error: string } {
    if (!Array.isArray(value)) return { ok: false, error: "memberIds must be a list of bot IDs" };
    const invalidIndex = value.findIndex(
      (id) => typeof id !== "string" || !id.trim() || !store.bot(id),
    );
    if (invalidIndex !== -1) {
      return { ok: false, error: `unknown channel member: ${String(value[invalidIndex])}` };
    }
    const memberIds = [...new Set(value as string[])];
    if (!memberIds.length) return { ok: false, error: "a channel needs at least one bot" };
    if (memberIds.every((id) => store.bot(id)?.hidden)) {
      return {
        ok: false,
        error: "a channel needs at least one active bot — every member given is archived",
      };
    }
    return { ok: true, memberIds };
  }
}
