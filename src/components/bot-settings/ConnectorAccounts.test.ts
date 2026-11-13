import { describe, expect, it } from "vitest";

import { accountRows, withAccount } from "./ConnectorAccounts";

const services = {
  github: { connected: true, accounts: [
    { id: "ca_team", alias: "team", status: "ACTIVE" },
    { id: "ca_milo", alias: "milo", status: "ACTIVE" },
    { id: "ca_old", status: "EXPIRED" },
  ] },
  gmail: { connected: true, accounts: [{ id: "ca_mail", status: "ACTIVE" }] },
  slack: { connected: false, accounts: [{ id: "ca_slack", status: "EXPIRED" }] },
  notion: { connected: true },
};
const milo = { id: "milo", name: "Milo", connectorAccounts: { github: { account: "ca_milo", exclusive: true as const } } };
const maus = { id: "maus", name: "MausBot" };

describe("the accounts a bot's Access page offers", () => {
  it("lists each app with a working account, and who keeps which account", () => {
    const rows = accountRows(maus, [milo, maus], services, { github: "GitHub" });
    expect(rows.map((row) => row.slug)).toEqual(["github", "gmail"]);
    expect(rows[0]).toEqual({
      slug: "github", label: "GitHub", value: "", exclusive: false, missing: false,
      choices: [{ id: "ca_team", name: "team", keptFor: [] }, { id: "ca_milo", name: "milo", keptFor: ["Milo"] }],
    });
    expect(rows[1]!.choices).toEqual([{ id: "ca_mail", name: "ca_mail", keptFor: [] }]);
  });

  it("shows the bot's own assignment, and says when its account is gone", () => {
    const own = accountRows(milo, [milo, maus], services)[0]!;
    expect(own).toMatchObject({ value: "ca_milo", exclusive: true, missing: false });
    expect(own.choices.find((choice) => choice.id === "ca_milo")!.keptFor, "its own account is not marked as another bot's").toEqual([]);
    const expired = accountRows({ id: "x", connectorAccounts: { github: { account: "ca_old" } } }, [], services)[0]!;
    expect(expired).toMatchObject({ value: "ca_old", missing: true });
    expect(expired.choices.map((choice) => choice.id)).toContain("ca_old");
    const removed = accountRows({ id: "x", connectorAccounts: { linear: { account: "ca_gone" } } }, [], services).find((row) => row.slug === "linear")!;
    expect(removed).toMatchObject({ value: "ca_gone", missing: true, choices: [] });
  });
});

describe("changing one app's account", () => {
  it("sets, marks and clears it without touching the others", () => {
    const current = { gmail: { account: "ca_mail" } };
    expect(withAccount(current, "github", "ca_milo", false)).toEqual({ gmail: { account: "ca_mail" }, github: { account: "ca_milo" } });
    expect(withAccount(current, "github", "ca_milo", true)).toEqual({ gmail: { account: "ca_mail" }, github: { account: "ca_milo", exclusive: true } });
    expect(withAccount({ ...current, github: { account: "ca_milo", exclusive: true } }, "github", "", true)).toEqual(current);
    expect(withAccount(undefined, "github", "", false)).toEqual({});
    expect(current).toEqual({ gmail: { account: "ca_mail" } });
  });
});
