import { expect, test } from "bun:test";

import { cleanSignupSource, signupSourceFromQuery } from "./signupSource";

test("a signup link's query becomes a source", () => {
  expect(
    signupSourceFromQuery(
      "?email=a%40b.com&entry=/glossary/qapi&from=/pricing&ref=www.google.com&utm_source=Newsletter&utm_medium=email&utm_campaign=oct",
    ),
  ).toEqual({
    entryPath: "/glossary/qapi",
    fromPath: "/pricing",
    referrerHost: "www.google.com",
    utmSource: "newsletter",
    utmMedium: "email",
    utmCampaign: "oct",
  });
});

test("nothing to say is null", () => {
  expect(signupSourceFromQuery("")).toBeNull();
  expect(signupSourceFromQuery("?email=a%40b.com")).toBeNull();
  expect(cleanSignupSource(null)).toBeNull();
  expect(cleanSignupSource("glossary")).toBeNull();
});

test("only well-formed values are kept", () => {
  expect(
    cleanSignupSource({
      entryPath: "https://evil.example/glossary",
      fromPath: "/pricing?email=a@b.com",
      referrerHost: "Google.COM",
      utmSource: "jordan@example.com",
      utmMedium: "x".repeat(101),
      utmCampaign: "<script>",
      email: "jordan@example.com",
    }),
  ).toEqual({ referrerHost: "google.com" });
});
