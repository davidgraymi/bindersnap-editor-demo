import { describe, expect, test } from "bun:test";

import type { SignOffRule } from "../../packages/utils/codeowners";
import {
  buildSignOffChange,
  placesGroupSignsOff,
  reasonFor,
  signOffReach,
  type SignOffDocument,
} from "./sign-off-view";

const HAND = "01J8XZ4K7MQ9V3B0RN7YHS2E1D";
const SEPSIS = "01J8XZ4K7MQ9V3B0RN7YHS2E2F";
const documents: SignOffDocument[] = [
  {
    path: `clinical/hand-hygiene.${HAND}.json`,
    uid: HAND,
    name: "hand-hygiene",
  },
  { path: `clinical/sepsis.${SEPSIS}.json`, uid: SEPSIS, name: "sepsis" },
  { path: "contracts/supplier.docx", uid: null, name: "supplier" },
];
const folder = (target: string, teams: string[]): SignOffRule => ({
  scope: "folder",
  target,
  teams,
  users: [],
});

describe("buildSignOffChange", () => {
  test("is null for a change that leaves the rules file alone", () => {
    expect(
      buildSignOffChange({
        paths: ["clinical/a.md"],
        before: [],
        after: [folder("clinical", ["ic"])],
        documents,
      }),
    ).toBeNull();
  });

  test("names each edited rule and the documents it will cover", () => {
    const change = buildSignOffChange({
      paths: [".gitea/CODEOWNERS", documents[0]!.path],
      before: [folder("clinical", ["ic"])],
      after: [folder("clinical", ["ic", "quality"])],
      documents,
    });
    expect(change!.rules).toHaveLength(1);
    const [rule] = change!.rules;
    expect(rule!.place).toBe("clinical");
    expect(rule!.teams.added).toEqual(["quality"]);
    expect(rule!.covers.map((document) => document.name)).toEqual([
      "hand-hygiene",
      "sepsis",
    ]);
  });

  test("a document rule's place is that document's path", () => {
    const change = buildSignOffChange({
      paths: [".gitea/CODEOWNERS"],
      before: [],
      after: [
        { scope: "document", target: SEPSIS, teams: ["pharmacy"], users: [] },
      ],
      documents,
    });
    expect(change!.rules[0]!.place).toBe(documents[1]!.path);
  });
});

describe("reasonFor", () => {
  test("a folder rule names the changed documents it matched", () => {
    expect(
      reasonFor(folder("clinical", ["ic"]), [
        documents[0]!.path,
        "contracts/supplier.docx",
        ".gitea/CODEOWNERS",
      ]),
    ).toEqual({ kind: "folder", matched: [documents[0]!.path] });
  });

  test("the binder's approvers, the binder rule and the rules rule", () => {
    expect(reasonFor(null, []).kind).toBe("approvers");
    expect(
      reasonFor({ scope: "rules", target: "", teams: ["p"], users: [] }, [])
        .kind,
    ).toBe("rules");
  });
});

describe("placesGroupSignsOff", () => {
  test("lists every rule naming the group, with what it covers", () => {
    const places = placesGroupSignsOff({
      binder: "governance",
      group: "Infection-Control",
      rules: [
        folder("clinical", ["infection-control"]),
        folder("contracts", ["legal"]),
        {
          scope: "binder",
          target: "",
          teams: ["infection-control"],
          users: [],
        },
      ],
      documents,
    });
    expect(places.map((place) => `${place.scope}:${place.place}`)).toEqual([
      "folder:clinical",
      "binder:",
    ]);
    expect(places[0]!.covers).toHaveLength(2);
  });
});

describe("signOffReach", () => {
  test("a group not granted on the binder has no access", () => {
    const reach = signOffReach({
      grantedGroups: [{ name: "Editors", members: ["alice"] }],
      owners: ["owner"],
      openToOrganization: false,
    });
    expect(reach.group("Editors")).toBe(true);
    expect(reach.group("Owners")).toBe(true);
    expect(reach.group("Pharmacy")).toBe(false);
    expect(reach.person("ALICE")).toBe(true);
    expect(reach.person("bob")).toBe(false);
  });

  test("a binder open to the organization is readable by everyone", () => {
    const reach = signOffReach({
      grantedGroups: [],
      owners: [],
      openToOrganization: true,
    });
    expect(reach.group("Pharmacy")).toBe(true);
    expect(reach.person("bob")).toBe(true);
  });
});
