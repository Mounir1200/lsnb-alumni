import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { signOutAndLeave } from "../../../src/auth/signOut.ts";
import { fetchPublicProfiles } from "../../../src/lib/publicProfiles.ts";
import { createServiceRpc, NotificationError } from "../notifications/delivery.js";

test("signing out ends the session before clearing drafts and leaving", async () => {
  const steps: string[] = [];
  await signOutAndLeave({ signOut: async () => { steps.push("session"); return { error: null }; } },
    () => steps.push("drafts"), () => steps.push("home"));
  assert.deepEqual(steps, ["session", "drafts", "home"]);
});

function publicClient(response: () => Response) {
  return createClient("https://database.example", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input) => {
      assert.equal(new URL(String(input)).pathname, "/rest/v1/rpc/public_directory_profiles");
      return response();
    } },
  });
}

test("visitors read the public listing as directory cards", async () => {
  const row = { id: "2f1c", first_name: "Awa", last_name: "Traoré", member_role: "alumni", graduation_year: 2019,
    specialty: "Data science", specialties: [], domain: "Numérique", city: "Paris", country: "France", photo_url: null, offers_mentoring: false };
  const profiles = await fetchPublicProfiles(publicClient(() => Response.json([row])));
  assert.deepEqual(profiles.map((profile) => [profile.id, profile.firstName, profile.isDemo]), [["2f1c", "Awa", false]]);
  await assert.rejects(fetchPublicProfiles(publicClient(() => Response.json({ code: "PGRST202", message: "missing" }, { status: 404 }))));
});

test("the service RPC reports storage failures without upstream details", async () => {
  const config = { supabaseUrl: "https://project.supabase.co", secretKey: "eyJlegacy-service-key" };
  const isStorage = (status: number) => (error: unknown) =>
    error instanceof NotificationError && error.stage === "storage" && error.status === status && !error.message.includes("secret");
  const withLegacyKey = createServiceRpc(config, async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${config.secretKey}`);
    throw new Error("network down");
  });
  await assert.rejects(withLegacyKey("anything", {}), isStorage(503));
  await assert.rejects(createServiceRpc(config, async () => new Response("secret details", { status: 500 }))("anything", {}), isStorage(500));
  await assert.rejects(createServiceRpc(config, async () => new Response("{not json", { status: 200 }))("anything", {}), isStorage(502));
  assert.equal(await createServiceRpc(config, async () => new Response("", { status: 200 }))("anything", {}), undefined);
});
