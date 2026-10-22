import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getSafeProfileLink, normalizeProfileLink } from "../../../src/lib/profileLinks.ts";

test("neither profile link is required, including whitespace-only values", () => {
  for (const kind of ["linkedin", "portfolio"] as const) {
    for (const value of [undefined, null, "", "   ", "\t\n"]) {
      assert.equal(normalizeProfileLink(value, kind), null);
      assert.equal(getSafeProfileLink(value, kind), undefined);
    }
  }
});

test("LinkedIn and portfolio are independent and preserve valid URL paths", () => {
  assert.equal(normalizeProfileLink(" https://fr.linkedin.com/in/awa-ouedraogo/?trk=profile#about ", "linkedin"),
    "https://fr.linkedin.com/in/awa-ouedraogo/?trk=profile#about");
  assert.equal(normalizeProfileLink(" https://awa.example/projects?lang=fr#work ", "portfolio"),
    "https://awa.example/projects?lang=fr#work");
  assert.throws(() => normalizeProfileLink("http://awa.example/", "portfolio"), /https:\/\//);
});

test("links reject active content, incomplete URLs, credentials and malformed addresses", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "ftp://files.example", "//site.example",
    "www.site.example", "https:///missing-host.example", "https://", "https://user:password@site.example/",
    "https://site.example/a b", "https://site.example/a\nb", "https://site.example\\evil", "https://site.example:99999/"]) {
    // URL() accepts triple slashes, but an address supplied by a member must have an explicit authority.
    assert.throws(() => normalizeProfileLink(value, "portfolio"), Error, value);
    assert.equal(getSafeProfileLink(value, "portfolio"), undefined, value);
  }
});

test("LinkedIn accepts member profiles and rejects lookalike domains and non-profile pages", () => {
  for (const value of ["https://linkedin.com/in/awa", "https://www.linkedin.com/in/awa/", "https://fr.linkedin.com:443/in/awa", "https://www.linkedin.com./in/awa"]) {
    assert.equal(normalizeProfileLink(value, "linkedin"), new URL(value).href);
  }
  for (const value of ["https://linkedin.com.evil.example/in/awa", "https://evil-linkedin.com/in/awa",
    "https://www.linkedin.com/", "https://www.linkedin.com/company/example", "https://www.linkedin.com/in/",
    "https://www.linkedin.com/in/awa/details", "https://www.linkedin.com:8443/in/awa"]) {
    assert.throws(() => normalizeProfileLink(value, "linkedin"), /LinkedIn/, value);
  }
});

test("profile links enforce the 2048-character storage limit", () => {
  const prefix = "https://portfolio.example/";
  const link = prefix + "a".repeat(2048 - prefix.length);
  assert.equal(normalizeProfileLink(link, "portfolio"), link);
  assert.throws(() => normalizeProfileLink(link + "a", "portfolio"), /2048/);
  assert.throws(() => normalizeProfileLink(prefix + "é".repeat(400), "portfolio"), /2048/);
});

test("stored URLs use the canonical host and path accepted by the database", () => {
  assert.equal(normalizeProfileLink("https://www.linkedin.com/in/awa/../awa", "linkedin"), "https://www.linkedin.com/in/awa");
  assert.equal(normalizeProfileLink("https://portfolio😀.example/", "portfolio"), "https://xn--portfolio-ob26h.example/");
});

const hostCases = JSON.parse(readFileSync(new URL("./fixtures/profile-links.json", import.meta.url), "utf8")) as {
  allowed: string[]; rejected: string[];
};

test("public HTTPS hosts remain accepted, including public IPv4 and IPv6", () => {
  for (const value of hostCases.allowed) {
    assert.equal(normalizeProfileLink(value, "portfolio"), new URL(value).href, value);
  }
});

test("HTTP and local/private hosts are rejected, including browser-normalized IP representations", () => {
  for (const value of hostCases.rejected) {
    assert.throws(() => normalizeProfileLink(value, "portfolio"), Error, value);
    assert.equal(getSafeProfileLink(value, "portfolio"), undefined, value);
  }
  assert.throws(() => normalizeProfileLink("http://www.linkedin.com/in/awa", "linkedin"), /https:\/\//);
});
