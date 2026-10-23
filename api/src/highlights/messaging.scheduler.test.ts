import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildApp } from "../app.js";
import { configuredNotificationScheduler, createNotificationScheduler } from "../messaging/scheduler.js";

const apiKey="test-brevo-key-never-log";
const token=createHmac("sha256",apiKey).update("lsnb-messaging-scheduler-v1").digest("hex");
const auth={authorization:`Bearer ${token}`};
const config={host:"localhost",port:0,logLevel:"silent",allowedOrigins:new Set<string>()};

test("notification trigger rejects raw provider keys, member JWTs and incorrect HMACs without running delivery",async()=>{
  let runs=0;
  const backend=createNotificationScheduler(apiKey,async()=>{runs++;return {claimed:0,delivered:0,failed:0}});
  const app=await buildApp({config,logger:false,notificationScheduler:backend});
  try {
    for(const authorization of [undefined,`Bearer ${apiKey}`,'Bearer eyJ.member-token.signature',`Bearer ${'0'.repeat(64)}`,`Bearer ${token.slice(0,62)}`]) {
      const response=await app.inject({method:'POST',url:'/messaging/notifications/run',...(authorization?{headers:{authorization}}:{}),payload:{}});
      assert.equal(response.statusCode,401);assert.equal(response.headers['cache-control'],'no-store');
      assert.ok(!response.body.includes(apiKey));assert.ok(!response.body.includes(token));
    }
    assert.equal(runs,0);
    const response=await app.inject({method:'POST',url:'/messaging/notifications/run',headers:auth});
    assert.equal(response.statusCode,200);assert.equal(runs,1);
  }finally{await app.close()}
});

test("notification trigger cannot choose recipients or messages and returns only bounded counters",async()=>{
  let runs=0;
  const app=await buildApp({config,logger:false,notificationScheduler:createNotificationScheduler(apiKey,async()=>{
    runs++;return {claimed:2,delivered:1,failed:1,email:'private@example.test',secret:apiKey};
  })});
  try {
    for(const payload of [{email:'attacker@example.test'},{recipient_id:'forged'},{message:'Spam'},[]]) {
      const response=await app.inject({method:'POST',url:'/messaging/notifications/run',headers:auth,payload});
      assert.equal(response.statusCode,400);
    }
    assert.equal((await app.inject({method:'POST',url:'/messaging/notifications/run',headers:{...auth,'content-type':'application/json'},payload:'null'})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/messaging/notifications/run?recipient_id=forged',headers:auth,payload:{}})).statusCode,400);
    assert.equal(runs,0);
    const success=await app.inject({method:'POST',url:'/messaging/notifications/run',headers:auth,payload:{}});
    assert.equal(success.statusCode,200);assert.equal(success.headers['cache-control'],'no-store');
    assert.deepEqual(success.json(),{claimed:2,delivered:1,failed:1});assert.equal(runs,1);
  }finally{await app.close()}
});

test("disabled or incompletely configured notification deployments fail closed",async()=>{
  const secrets={BREVO_API_KEY:apiKey,SUPABASE_SECRET_KEY:'database-secret',SUPABASE_URL:'https://project.supabase.co',
    MESSAGING_SITE_URL:'https://site.example.test',MESSAGING_FROM_EMAIL:'sender@example.test'};
  for(const enabled of [undefined,'false','TRUE'])assert.equal(configuredNotificationScheduler({...secrets,MESSAGING_EMAIL_ENABLED:enabled}),undefined);
  assert.throws(()=>configuredNotificationScheduler({MESSAGING_EMAIL_ENABLED:'true',BREVO_API_KEY:apiKey}));
  assert.ok(configuredNotificationScheduler({...secrets,MESSAGING_EMAIL_ENABLED:'true'}));
  const app=await buildApp({config,logger:false});
  try {
    const response=await app.inject({method:'POST',url:'/messaging/notifications/run',headers:auth,payload:{}});
    assert.equal(response.statusCode,503);assert.equal(response.headers['cache-control'],'no-store');
  }finally{await app.close()}
});

test("provider/storage errors and malformed results never leak sensitive upstream details",async()=>{
  for(const run of [async()=>{throw new Error(`private@example.test ${apiKey} ${token} database-secret`)},
    async()=>({claimed:6,delivered:6,failed:0}),async()=>({claimed:1,delivered:0,failed:0})]) {
    const app=await buildApp({config,logger:false,notificationScheduler:createNotificationScheduler(apiKey,run)});
    try {
      const response=await app.inject({method:'POST',url:'/messaging/notifications/run',headers:auth,payload:{}});
      assert.equal(response.statusCode,503);assert.equal(response.headers['cache-control'],'no-store');
      for(const secret of [apiKey,token,'private@example.test','database-secret'])assert.ok(!response.body.includes(secret));
    }finally{await app.close()}
  }
});

test("scheduled workflow has no database credential, dependency install or arbitrary mail payload",async()=>{
  const workflow=await readFile(new URL('../../../.github/workflows/messaging-notifications.yml',import.meta.url),'utf8');
  assert.ok(!workflow.includes('SUPABASE_SECRET_KEY'));assert.ok(!workflow.includes('npm ci'));assert.ok(!workflow.includes('actions/checkout'));
  assert.match(workflow,/MESSAGING_API_URL/);assert.match(workflow,/AbortSignal\.timeout\(180_000\)/);
  assert.match(workflow,/lsnb-messaging-scheduler-v1/);assert.match(workflow,/permissions: \{\}/);
  assert.match(workflow,/github\.event\.repository\.private == false/);
});
