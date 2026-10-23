import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../app.js";
import { createEnrollmentBackend, enrollmentCodeHash, EnrollmentError } from "../messaging/enrollment.js";
import { generateMessagingIdentity } from "../../../src/lib/messagingCrypto.ts";

const config = { supabaseUrl:"https://project.supabase.co", secretKey:"server-secret", apiKey:"brevo-secret",
  fromEmail:"sender@example.test", siteUrl:"https://network.example.test" };
const userId = randomUUID();
const user = { id:userId, email:"owner@example.test", email_confirmed_at:"2026-10-23T20:00:00Z" };

test("activation verifies the bearer with Auth, derives recipient server-side and stores only a salted code hash", async () => {
  const calls: {url:string; body:any; headers:Headers}[]=[];
  const backend=createEnrollmentBackend(config,async(input,init)=>{
    const url=String(input),body=init?.body?JSON.parse(String(init.body)):null;
    calls.push({url,body,headers:new Headers(init?.headers)});
    if(url.endsWith('/auth/v1/user'))return Response.json(user);
    if(url.endsWith('/messaging_begin_identity_enrollment'))return Response.json('2026-10-23T22:10:00Z');
    if(url==='https://api.brevo.com/v3/smtp/email')return Response.json({messageId:'ok'},{status:201});
    throw new Error('Unexpected endpoint');
  });
  const result=await backend.start('user-token');
  assert.equal(calls[0]!.headers.get('authorization'),'Bearer user-token');
  assert.equal(calls[1]!.headers.get('authorization'),null);
  assert.deepEqual(calls[2]!.body.to,[{email:user.email}]);
  assert.equal(calls[2]!.headers.get('apikey'),null);
  assert.equal(calls[2]!.headers.get('api-key'),config.apiKey);
  const code=calls[2]!.body.textContent.match(/\b\d{8}\b/)?.[0];assert.ok(code);
  assert.equal(calls[1]!.body.p_code_hash,enrollmentCodeHash(result.challengeId,code));
  assert.ok(!JSON.stringify(result).includes(code));
  assert.ok(!JSON.stringify(calls[1]!.body).includes(code));
});

test("unconfirmed or invalid sessions never receive enrollment codes",async()=>{
  for(const value of [{...user,email_confirmed_at:null},{id:'forged',email:user.email},null]){
    let calls=0;const backend=createEnrollmentBackend(config,async()=>{calls++;return Response.json(value)});
    await assert.rejects(backend.start('token'),(e:unknown)=>e instanceof EnrollmentError&&e.status===401);
    assert.equal(calls,1);
  }
});

test("database throttling and provider failures stay generic and never leak keys or the code",async()=>{
  const backend=createEnrollmentBackend(config,async(input)=>String(input).endsWith('/auth/v1/user')
    ?Response.json(user):Response.json({code:'54000',message:'Sensitive upstream response'},{status:400}));
  await assert.rejects(backend.start('token'),(e:unknown)=>e instanceof EnrollmentError&&e.status===429&&!e.message.includes('Sensitive'));
});

test("completion validates P256 public material and uses the authenticated user id and hashed OTP",async()=>{
  const identity=await generateMessagingIdentity(userId);
  const challengeId=randomUUID();
  const input={challengeId,code:'01234567',publicKey:identity.identity.public_key,encryptedPrivateKey:identity.identity.encrypted_private_key};
  let captured:any;
  const backend=createEnrollmentBackend(config,async(url,init)=>{
    if(String(url).endsWith('/auth/v1/user'))return Response.json(user);
    captured=JSON.parse(String(init?.body));return Response.json(true);
  });
  await backend.complete('token',input);
  assert.equal(captured.p_user_id,userId);
  assert.equal(captured.p_code_hash,enrollmentCodeHash(challengeId,'01234567'));
  assert.ok(!JSON.stringify(captured).includes(identity.recoverySecret));
  assert.ok(!JSON.stringify(captured).includes('01234567'));
  for(const patch of [{userId:randomUUID()},{publicKey:'A'.repeat(87)},{code:'123456'},{encryptedPrivateKey:{...input.encryptedPrivateKey,privateKey:'clear'}}]){
    await assert.rejects(backend.complete('token',{...input,...patch} as any),(e:unknown)=>e instanceof EnrollmentError&&e.status===400);
  }
});

test("activation HTTP routes reject anonymous, body-selected recipients, plaintext key and malformed enrollment without invoking backend",async()=>{
  let calls=0;
  const app=await buildApp({config:{host:'localhost',port:0,logLevel:'silent',allowedOrigins:new Set()},logger:false,
    enrollmentBackend:{start:async()=>{calls++;return{challengeId:randomUUID(),expiresAt:new Date().toISOString()}},complete:async()=>{calls++}}});
  try{
    assert.equal((await app.inject({method:'POST',url:'/messaging/identity/challenge',payload:{}})).statusCode,401);
    assert.equal((await app.inject({method:'POST',url:'/messaging/identity/challenge',headers:{authorization:'Bearer token'},payload:{email:'attacker@example.test'}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/messaging/identity',headers:{authorization:'Bearer token'},payload:{code:'12345678',privateKey:'clear'}})).statusCode,400);
    assert.equal(calls,0);
    const valid=await app.inject({method:'POST',url:'/messaging/identity/challenge',headers:{authorization:'Bearer token'},payload:{}});
    assert.equal(valid.statusCode,200);assert.equal(valid.headers['cache-control'],'no-store');assert.equal(calls,1);
  }finally{await app.close()}
});
