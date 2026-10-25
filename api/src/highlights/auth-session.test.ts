import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { browserAuthOptions, emailSignupAuthOptions, linkAuthOptions } from "../../../src/lib/authOptions.ts";

test("the installed SDK rejects implicit URL sessions on site and hub without replacing stored identity", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const location = { href: "", hash: "" };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location, addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} } });
  try {
    for (const path of ["/auth/callback", "/", "/hub"]) {
      for (const payload of ["#access_token=attacker&refresh_token=refresh&expires_in=3600&token_type=bearer", "?%61ccess_token=attacker&refresh_token=refresh&expires_in=3600&token_type=bearer"]) {
        location.href = `https://site.test${path}${payload}`;
        location.hash = new URL(location.href).hash;
        const key = `test-auth-${path}-${payload}`;
        const original = JSON.stringify({ user: { id: "victim" }, access_token: "original", refresh_token: "original", expires_at: 9999999999 });
        const storage = new Map([[key, original]]);
        let network = 0;
        const client = createClient("https://project.supabase.co", "public-key", {
          auth: { ...browserAuthOptions, autoRefreshToken: false, storageKey: key, storage: {
            getItem: (name) => storage.get(name) ?? null,
            setItem: (name, value) => { storage.set(name, value); },
            removeItem: (name) => { storage.delete(name); },
          } },
          global: { fetch: async () => { network++; throw new Error("Unexpected network"); } },
        });
        try {
          const initialized = await client.auth.initialize();
          assert.ok(initialized.error);
          assert.equal(network, 0);
          assert.equal(storage.get(key), original);
        } finally {
          client.auth.stopAutoRefresh();
          (client.auth as any).broadcastChannel?.close();
        }
      }
    }
  } finally {
    for (const [key, descriptor] of [["window", previousWindow], ["document", previousDocument]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("email account verification keeps its candidate only in memory", async () => {
  let writes = 0;
  const client = createClient("https://project.supabase.co", "public-key", {
    auth: { ...linkAuthOptions, storage: {
      getItem: () => null, setItem: () => { writes++; }, removeItem: () => { writes++; },
    } },
    global: { fetch: async () => Response.json({ access_token: "candidate", refresh_token: "refresh", expires_in: 3600,
      token_type: "bearer", user: { id: "other-account", email: "other@example.test" } }) },
  });
  const { data, error } = await client.auth.verifyOtp({ token_hash: "unused-link", type: "email" });
  assert.equal(error, null);
  assert.equal(data.user?.email, "other@example.test");
  assert.equal((await client.auth.getSession()).data.session?.user.id, "other-account");
  assert.equal(writes, 0);
  client.auth.stopAutoRefresh();
});

test("the installed SDK still exchanges a browser-bound PKCE code", async () => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const location = { href: "https://site.test/auth/callback?code=legitimate-code", hash: "" };
  const key = "pkce-control";
  const storage = new Map([[`${key}-code-verifier`, JSON.stringify("browser-generated-verifier")]]);
  Object.defineProperty(globalThis,"window",{configurable:true,value:{location,addEventListener(){},removeEventListener(){},
    history:{replaceState(_state: unknown,_title: string,url: string){location.href=String(url)}}}});
  Object.defineProperty(globalThis,"document",{configurable:true,value:{visibilityState:"visible",title:"",addEventListener(){},removeEventListener(){}}});
  const exchanges: unknown[] = [];
  const client = createClient("https://project.supabase.co","public-key",{
    auth:{...browserAuthOptions,autoRefreshToken:false,storageKey:key,storage:{getItem:(name)=>storage.get(name)??null,
      setItem:(name,value)=>{storage.set(name,value)},removeItem:(name)=>{storage.delete(name)}}},
    global:{fetch:async (url,init)=>{assert.match(String(url),/grant_type=pkce/);exchanges.push(JSON.parse(String(init?.body)));
      return Response.json({access_token:"legitimate",refresh_token:"refresh",expires_in:3600,token_type:"bearer",user:{id:"member",email:"member@example.test"}})}},
  });
  try {
    assert.equal((await client.auth.initialize()).error,null);
    assert.deepEqual(exchanges,[{auth_code:"legitimate-code",code_verifier:"browser-generated-verifier"}]);
    assert.equal((await client.auth.getSession()).data.session?.user.id,"member");
    assert.equal(new URL(location.href).searchParams.has("code"),false);
  } finally {
    // The SDK publishes its successful SIGNED_IN event on the next timer turn.
    await new Promise((resolve) => setTimeout(resolve, 0));
    client.auth.stopAutoRefresh();(client.auth as any).broadcastChannel?.close();
    for(const [name,descriptor] of [["window",savedWindow],["document",savedDocument]] as const) {
      if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);
    }
  }
});

test("email signup and resend issue cross-device links without a PKCE challenge or persistent session", async () => {
  let writes=0;
  const client=createClient("https://project.supabase.co","public-key",{
    auth:{...emailSignupAuthOptions,storage:{getItem:()=>null,setItem:()=>{writes++},removeItem:()=>{writes++}}},
    global:{fetch:async(url,init)=>{
      const request=new URL(String(url));assert.ok(["/auth/v1/signup","/auth/v1/resend"].includes(request.pathname));
      assert.equal(request.searchParams.get("redirect_to"),"https://site.test/auth/callback?next=%2Fannuaire");
      const body=JSON.parse(String(init?.body));assert.equal(body.code_challenge,null);assert.equal(body.code_challenge_method,null);
      return Response.json({id:"member",email:"member@example.test"});
    }},
  });
  const result=await client.auth.signUp({email:"member@example.test",password:"submitted-password",options:{emailRedirectTo:"https://site.test/auth/callback?next=%2Fannuaire"}});
  assert.equal(result.error,null);assert.equal(result.data.session,null);assert.equal(writes,0);
  assert.equal((await client.auth.resend({type:"signup",email:"member@example.test",options:{emailRedirectTo:"https://site.test/auth/callback?next=%2Fannuaire"}})).error,null);
  assert.equal(writes,0);
  client.auth.stopAutoRefresh();
});
