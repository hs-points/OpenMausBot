import { beforeEach, describe, expect, it } from "vitest";

import {
  accountChoiceFor, accountRulesFor, applyAccountRules, connectorAccountsPrompt, forgetAccountInventories, parseConnectorAccounts,
  recentAccountInventory, type AccountInventory, type AccountRules,
} from "./connector-accounts.ts";

const inventory: AccountInventory = {
  github: { accounts: [
    { id: "ca_team", alias: "team", status: "ACTIVE" },
    { id: "ca_milo", alias: "Milo", status: "ACTIVE" },
    { id: "ca_maus", alias: "maus", status: "ACTIVE" },
    { id: "ca_old", alias: "old", status: "EXPIRED" },
  ] },
  gmail: { accounts: [{ id: "ca_mail", status: "ACTIVE" }] },
};
const read = async () => inventory;
const call = (tools: unknown, name = "COMPOSIO_MULTI_EXECUTE_TOOL") => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { tools } } });
const sent = (decision: Awaited<ReturnType<typeof applyAccountRules>>) => {
  if (!decision.ok) throw new Error(decision.text);
  return (decision.payload as { params: { arguments: { tools: Array<{ tool_slug: string; account?: string }> } } }).params.arguments.tools.map((tool) => tool.account);
};
const refusal = (decision: Awaited<ReturnType<typeof applyAccountRules>>) => (decision.ok ? "" : decision.text);

const bots = [
  { id: "milo", connectorAccounts: { github: { account: "ca_milo", exclusive: true as const } } },
  { id: "maus", connectorAccounts: { github: { account: "ca_maus", exclusive: true as const } } },
  { id: "shared", connectorAccounts: { github: { account: "ca_team" } } },
  { id: "plain" },
];
const rules = (botId: string) => accountRulesFor(botId, bots)!;

describe("a bot's assigned accounts, as saved", () => {
  it("keeps only an account ID and the exclusive mark per app", () => {
    expect(parseConnectorAccounts({ github: { account: "ca_milo", exclusive: true }, gmail: { account: "ca_mail", exclusive: false } }))
      .toEqual({ ok: true, accounts: { github: { account: "ca_milo", exclusive: true }, gmail: { account: "ca_mail" } } });
    expect(parseConnectorAccounts(null)).toEqual({ ok: true, accounts: undefined });
    expect(parseConnectorAccounts({})).toEqual({ ok: true, accounts: undefined });
  });

  it("refuses anything else", () => {
    for (const bad of [[], "ca_milo", { GitHub: { account: "ca_milo" } }, { github: "ca_milo" }, { github: { account: "../x" } }, { github: { account: "" } },
      { github: { account: "ca_milo", exclusive: "yes" } }, { github: { account: "ca_milo", token: "x" } }]) {
      expect(parseConnectorAccounts(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("which rules reach a bot", () => {
  it("are none while no bot has an account assigned", () => {
    expect(accountRulesFor("plain", [{ id: "plain" }, { id: "other" }])).toBeNull();
    expect(accountRulesFor("plain", [{ id: "plain" }, { id: "other", connectorAccounts: { github: { account: "ca_team" } } }]), "another bot's shared pick").toBeNull();
  });

  it("are its own accounts and the ones other bots keep to themselves", () => {
    expect(rules("milo")).toEqual({ own: { github: { account: "ca_milo", exclusive: true } }, reserved: { github: ["ca_maus"] } });
    expect(rules("plain")).toEqual({ own: {}, reserved: { github: ["ca_milo", "ca_maus"] } });
    const twins = [{ id: "a", connectorAccounts: { github: { account: "ca_x", exclusive: true as const } } }, { id: "b", connectorAccounts: { github: { account: "ca_x" } } }];
    expect(accountRulesFor("b", twins), "two bots assigned the same account both use it").toEqual({ own: { github: { account: "ca_x" } }, reserved: {} });
  });

  it("give an automation the same choice", () => {
    expect(accountChoiceFor(rules("milo"), "github")).toEqual({ only: "ca_milo" });
    expect(accountChoiceFor(rules("plain"), "github")).toEqual({ except: ["ca_milo", "ca_maus"] });
    expect(accountChoiceFor(rules("plain"), "gmail")).toBeNull();
    expect(accountChoiceFor(null, "github")).toBeNull();
  });
});

describe("a call from a bot with an assigned account", () => {
  it("always leaves with that account, whatever the bot asked for", async () => {
    const tools = [
      { tool_slug: "GITHUB_GET_A_REPOSITORY", arguments: { repo: "x" } },
      { tool_slug: "GITHUB_LIST_ISSUES", arguments: {}, account: "maus" },
      { tool_slug: "GITHUB_LIST_ISSUES", arguments: {}, account: "ca_team" },
      { tool_slug: "GMAIL_FETCH_EMAILS", arguments: {}, account: "work" },
    ];
    const decision = await applyAccountRules(call(tools), rules("milo"), read, ["github", "gmail"]);
    expect(sent(decision)).toEqual(["ca_milo", "ca_milo", "ca_milo", "work"]);
    expect(decision.ok && decision.used).toEqual({ github: "ca_milo" });
    expect(tools[1]!.account, "the bot's own frame is not changed in place").toBe("maus");
  });

  it("is refused, never moved to another account, when the assigned one is gone or signed out", async () => {
    const gone: AccountRules = { own: { github: { account: "ca_removed" } }, reserved: {} };
    expect(refusal(await applyAccountRules(call([{ tool_slug: "GITHUB_LIST_ISSUES" }]), gone, read))).toMatch(/no longer connected.*No other account was used/);
    const expired: AccountRules = { own: { github: { account: "ca_old" } }, reserved: {} };
    expect(refusal(await applyAccountRules(call([{ tool_slug: "GITHUB_LIST_ISSUES" }]), expired, read))).toMatch(/no longer connected/);
  });

  it("is refused when the accounts cannot be read", async () => {
    const decision = await applyAccountRules(call([{ tool_slug: "GITHUB_LIST_ISSUES" }]), rules("milo"), async () => { throw new Error("offline"); });
    expect(refusal(decision)).toMatch(/could not check/);
  });

  it("finds the app however its slug is spelled", async () => {
    const drive: AccountRules = { own: { "google-drive": { account: "ca_drive" } }, reserved: {} };
    const known = { "google-drive": { accounts: [{ id: "ca_drive", status: "ACTIVE" }] } };
    for (const slug of ["GOOGLEDRIVE_FIND_FILE", "GOOGLE_DRIVE_FIND_FILE"]) {
      expect(sent(await applyAccountRules(call([{ tool_slug: slug, account: "other" }]), drive, async () => known)), slug).toEqual(["ca_drive"]);
    }
    const google: AccountRules = { own: { google: { account: "ca_google" } }, reserved: {} };
    const frame = call([{ tool_slug: "GOOGLE_DRIVE_FIND_FILE", account: "other" }]);
    expect(sent(await applyAccountRules(frame, google, read, ["google", "google_drive"])), "a longer connected app is not taken for a shorter one").toEqual(["other"]);
  });
});

describe("a call from a bot without an assigned account", () => {
  it("never reaches an account another bot keeps to itself", async () => {
    for (const account of ["ca_milo", "milo", "MILO", " Milo ", "ca_maus", "maus"]) {
      const decision = await applyAccountRules(call([{ tool_slug: "GITHUB_LIST_ISSUES", account }]), rules("plain"), read);
      expect(decision.ok, account).toBe(false);
      expect(refusal(decision), "says what it may use, not whose the other is").toBe("This bot has no Github account by that name; it may use team. This call was not run.");
    }
    expect((await applyAccountRules(call([{ tool_slug: "GITHUB_LIST_ISSUES", account: { id: "ca_milo" } }]), rules("plain"), read)).ok).toBe(false);
  });

  it("uses the one account left, by ID", async () => {
    expect(sent(await applyAccountRules(call([{ tool_slug: "GITHUB_LIST_ISSUES" }]), rules("plain"), read))).toEqual(["ca_team"]);
    expect(sent(await applyAccountRules(call([{ tool_slug: "GITHUB_LIST_ISSUES", account: "Team" }]), rules("plain"), read))).toEqual(["ca_team"]);
  });

  it("must name one when several are left, and has none when all are kept", async () => {
    const one: AccountRules = { own: {}, reserved: { github: ["ca_milo"] } };
    expect(refusal(await applyAccountRules(call([{ tool_slug: "GITHUB_LIST_ISSUES" }]), one, read))).toMatch(/pass account on the tool entry, one of team, maus/);
    expect(sent(await applyAccountRules(call([{ tool_slug: "GITHUB_LIST_ISSUES", account: "maus" }]), one, read))).toEqual(["ca_maus"]);
    const all: AccountRules = { own: {}, reserved: { github: ["ca_team", "ca_milo", "ca_maus"] } };
    expect(refusal(await applyAccountRules(call([{ tool_slug: "GITHUB_LIST_ISSUES" }]), all, read))).toMatch(/has no Github account/);
  });

  it("leaves other apps exactly as sent, without reading the accounts", async () => {
    const frame = call([{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: { q: "x" }, account: "work" }]);
    const decision = await applyAccountRules(frame, rules("plain"), async () => { throw new Error("not read"); });
    expect(decision).toEqual({ ok: true, payload: frame, used: {} });
    expect(decision.ok && decision.payload).toBe(frame);
  });
});

describe("calls OpenMausBot cannot check", () => {
  it("are refused once account rules reach the bot", async () => {
    for (const name of ["COMPOSIO_REMOTE_WORKBENCH", "COMPOSIO_REMOTE_BASH_TOOL", "COMPOSIO_PROXY_EXECUTE", "COMPOSIO_SOMETHING_NEW"]) {
      expect(refusal(await applyAccountRules(call(undefined, name), rules("plain"), read)), name).toMatch(/can't check which account/);
    }
    expect(refusal(await applyAccountRules(call([{ tool_slug: "GITHUB_LIST_ISSUES" }], "GITHUB_LIST_ISSUES"), rules("milo"), read))).toMatch(/COMPOSIO_MULTI_EXECUTE_TOOL/);
    expect(refusal(await applyAccountRules([call([{ tool_slug: "GITHUB_LIST_ISSUES" }])], rules("milo"), read)), "a batch").toMatch(/one call at a time/);
    expect(refusal(await applyAccountRules({ method: "tools/call" }, rules("milo"), read))).toMatch(/could not read this call/);
    for (const args of [undefined, "text", { tool_slug: "GITHUB_LIST_ISSUES" }, { tools: [] }, { tools: [{ slug: "GITHUB_LIST_ISSUES" }] }, { tools: ["GITHUB_LIST_ISSUES"] }]) {
      const frame = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "COMPOSIO_MULTI_EXECUTE_TOOL", arguments: args } };
      expect((await applyAccountRules(frame, rules("milo"), read)).ok, JSON.stringify(args)).toBe(false);
    }
  });

  it("include disconnecting an account through Composio's connection tool", async () => {
    for (const args of [{ toolkits: [{ name: "github", action: "remove" }] }, { toolkits: ["github"], action: "disconnect" }, { toolkits: [{ toolkit: "github", action: "DELETE", account: "milo" }] }]) {
      const frame = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "COMPOSIO_MANAGE_CONNECTIONS", arguments: args } };
      expect(refusal(await applyAccountRules(frame, rules("plain"), read)), JSON.stringify(args)).toMatch(/can't disconnect/);
    }
    const add = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "COMPOSIO_MANAGE_CONNECTIONS", arguments: { toolkits: ["github"] } } };
    expect((await applyAccountRules(add, rules("plain"), read)).ok).toBe(true);
  });

  it("do not include search, schemas, connection cards or other protocol frames", async () => {
    for (const name of ["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_WAIT_FOR_CONNECTIONS", "GITHUB_MANAGE_CONNECTIONS"]) {
      expect((await applyAccountRules(call(undefined, name), rules("milo"), read)).ok, name).toBe(true);
    }
    const list = { jsonrpc: "2.0", id: 2, method: "tools/list" };
    expect(await applyAccountRules(list, rules("milo"), read)).toEqual({ ok: true, payload: list, used: {} });
    expect((await applyAccountRules(call([{ tool_slug: "GMAIL_FETCH_EMAILS" }], "GMAIL_FETCH_EMAILS"), rules("milo"), read)).ok, "a direct call to an app without a rule").toBe(true);
  });
});

describe("what the bot is told", () => {
  it("names the apps with an assigned account, and nothing without one", () => {
    expect(connectorAccountsPrompt(undefined)).toBe("");
    expect(connectorAccountsPrompt({})).toBe("");
    const line = connectorAccountsPrompt({ github: { account: "ca_milo" }, google_drive: { account: "ca_drive" } });
    expect(line).toContain("Github, Google Drive");
    expect(line, "never the account ID").not.toMatch(/ca_/);
  });
});

describe("the accounts read for a turn's calls", () => {
  beforeEach(() => forgetAccountInventories());

  it("are read once per installation every few seconds, and again after a failure", async () => {
    let reads = 0;
    const once = async () => { reads += 1; return inventory; };
    await recentAccountInventory("server", once, 1_000);
    await recentAccountInventory("server", once, 5_000);
    expect(reads).toBe(1);
    await recentAccountInventory("member", once, 5_000);
    await recentAccountInventory("server", once, 30_000);
    expect(reads).toBe(3);
    forgetAccountInventories();
    await expect(recentAccountInventory("server", async () => { throw new Error("offline"); }, 1_000)).rejects.toThrow("offline");
    await new Promise((resolve) => setImmediate(resolve));
    await recentAccountInventory("server", once, 2_000);
    expect(reads).toBe(4);
  });
});
