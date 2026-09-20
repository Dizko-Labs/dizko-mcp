import test from "node:test";
import assert from "node:assert/strict";
import { callTool, tools } from "../src/tools.js";
const auth = (scopes) => ({ authenticated:true, subject:"user-1", clientId:"muse", token:"opaque", scopes });
const body = (r) => ({ ok:true, status:200, json:async()=>r, text:async()=>JSON.stringify(r) });
test("taste tools publish only their required OAuth scopes", () => {
  const taste=tools.find(t=>t.name==="get_taste_profile"), bin=tools.find(t=>t.name==="bin_event");
  assert.deepEqual(taste.securitySchemes,[{type:"oauth2",scopes:["saved:read"]}]);
  assert.deepEqual(bin.securitySchemes,[{type:"oauth2",scopes:["saved:write"]}]);
  assert.equal(taste.annotations.readOnlyHint,true); assert.equal(bin.annotations.destructiveHint,true);
});
test("get_taste_profile rejects missing scope", async()=>{
 const x=await callTool("get_taste_profile",{}, {authContext:auth(["events:read"])}); assert.equal(x.isError,true); assert.match(x.content[0].text,/insufficient_scope/);
});
test("get_taste_profile uses user OAuth token", async()=>{
 let req; const fetch=async(u,o)=>{req={u:String(u),o}; return body({profile_version:2,genres:{techno:.9},saved:[],binned:[]});};
 const x=await callTool("get_taste_profile",{}, {authContext:auth(["saved:read"]),fetch,config:{oauthIssuer:"https://api.dizko.test",apiTimeoutMs:1000}});
 assert.equal(req.u,"https://api.dizko.test/connector/v1/taste-profile"); assert.equal(req.o.headers.Authorization,"Bearer opaque"); assert.match(x.content[0].text,/profile_version/);
});
test("bin_event requires confirmation and forwards idempotency key", async()=>{
 const no=await callTool("bin_event",{event_id:"e",confirmed:false,idempotency_key:"abcdefghijklmnop"},{authContext:auth(["saved:write"])}); assert.equal(no.isError,true);
 let req; const fetch=async(u,o)=>{req={u:String(u),o}; return body({binned:true,created:true,event_id:"e"});};
 const yes=await callTool("bin_event",{event_id:"e",confirmed:true,idempotency_key:"abcdefghijklmnop"},{authContext:auth(["saved:write"]),fetch,config:{oauthIssuer:"https://api.dizko.test",apiTimeoutMs:1000}});
 assert.equal(req.u,"https://api.dizko.test/connector/v1/binned-events"); assert.equal(req.o.headers["Idempotency-Key"],"abcdefghijklmnop"); assert.match(yes.content[0].text,/binned/);
});
