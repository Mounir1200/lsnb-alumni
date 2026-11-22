import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

async function serviceBlock(service: string) {
  const block = (await read("render.yaml")).split(/\n {2}- type: /).find((part) => part.includes(`name: ${service}\n`));
  assert.ok(block, `${service} is declared in render.yaml`);
  return block;
}

/** The headers a static service of render.yaml sends on every path. */
async function headersOf(service: string) {
  return new Map([...(await serviceBlock(service)).matchAll(/- path: \/\*\n\s+name: (.+)\n\s+value: (.+)/g)]
    .map(([, name, value]) => [name!.trim(), value!.trim().replace(/^"|"$/g, "")]));
}

/** Each environment variable of a service, with the line that sets it ("sync: false" for the dashboard). */
async function envVarsOf(service: string) {
  return new Map([...(await serviceBlock(service)).matchAll(/- key: (\w+)\n\s+(.+)/g)].map(([, key, setting]) => [key!, setting!.trim()]));
}

const directives = (policy: string) => new Map(policy.split(";").map((part) => part.trim().split(/\s+/))
  .map(([name, ...sources]) => [name!, sources]));

for (const service of ["lsnb-alumni-web", "lsnb-alumni-hub"]) {
  test(`${service} forbids framing, sniffing, leaky referrers and plain HTTP, and keeps powerful features off`, async () => {
    const headers = await headersOf(service);
    assert.equal(headers.get("X-Frame-Options"), "DENY");
    assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.match(headers.get("Strict-Transport-Security") ?? "", /^max-age=31536000; includeSubDomains$/);
    assert.equal(headers.get("Cross-Origin-Opener-Policy"), "same-origin");
    assert.equal(headers.get("Permissions-Policy"), "camera=(), microphone=(), geolocation=()");
  });

  test(`${service} lets only its own code, its fonts, Cloudflare's anti-robot check and the project's Supabase and API run or connect`, async () => {
    const policy = directives((await headersOf(service)).get("Content-Security-Policy-Report-Only") ?? "");
    // Cloudflare Turnstile, on the sign-in forms: its script, and the frame it draws the check in.
    assert.deepEqual(policy.get("script-src"), ["'self'", "https://challenges.cloudflare.com"]);
    assert.deepEqual(policy.get("frame-src"), ["https://challenges.cloudflare.com"]);
    assert.deepEqual(policy.get("font-src"), ["'self'"]);
    assert.deepEqual(policy.get("frame-ancestors"), ["'none'"]);
    assert.deepEqual(policy.get("object-src"), ["'none'"]);
    // The photos a profile may show (private.is_allowed_photo_url): the project's storage and Google.
    // The school's photo on the home page comes from its own site (src/data/homePhotos.ts).
    const schoolPhoto = service === "lsnb-alumni-web" ? ["https://www.lobspaalga.com"] : [];
    assert.deepEqual(policy.get("img-src"), ["'self'", "data:", "blob:", "https://yesumbhssechcrlgpgqj.supabase.co", "https://*.googleusercontent.com", ...schoolPhoto]);
    assert.deepEqual(policy.get("connect-src"), ["'self'", "https://yesumbhssechcrlgpgqj.supabase.co",
      "wss://yesumbhssechcrlgpgqj.supabase.co", "https://lsnb-alumni-api.onrender.com"]);
  });

  test(`${service} takes the Turnstile site key from the Render dashboard`, async () => {
    assert.equal((await envVarsOf(service)).get("VITE_TURNSTILE_SITE_KEY"), "sync: false");
  });
}

test("the site and the hub load their fonts from themselves, never from Google", async () => {
  for (const page of ["index.html", "hub/index.html"]) assert.doesNotMatch(await read(page), /fonts\.(googleapis|gstatic)\.com/, page);
  assert.match(await read("src/fonts.css"), /font-family: "Bricolage Grotesque"[\s\S]*font-family: "Manrope"/);
});
