import assert from "node:assert/strict"; import test from "node:test";
import { verifyConnectorBearer } from "../src/connectorAuth.js";
import { callTool, tools } from "../src/tools.js";

test("introspection accepts only active access tokens for the exact MCP audience", async()=>{
 const fetch=async()=>new Response(JSON.stringify({active:true,token_type:"access",aud:"https://mcp.dizko.app/mcp",sub:"u1",client_id:"muse",scope:"events:read saved:write"}),{status:200});
 assert.deepEqual(await verifyConnectorBearer("tok",{fetch,config:{oauthIssuer:"https://api.dizko.app",oauthResource:"https://mcp.dizko.app/mcp",introspectionSecret:"secret",apiTimeoutMs:1000}}),{subject:"u1",clientId:"muse",scopes:["events:read","saved:write"]});
 const wrong=async()=>new Response(JSON.stringify({active:true,token_type:"refresh",aud:"https://mcp.dizko.app/mcp",sub:"u1",scope:"saved:write"}),{status:200});
 assert.equal(await verifyConnectorBearer("tok",{fetch:wrong,config:{oauthIssuer:"https://api.dizko.app",oauthResource:"https://mcp.dizko.app/mcp",introspectionSecret:"secret",apiTimeoutMs:1000}}),null);
});

test("write tool advertises OAuth scope and defaults denied",async()=>{
 const tool=tools.find(x=>x.name==="save_event"); assert.deepEqual(tool.securitySchemes,[{type:"oauth2",scopes:["saved:write"]}]);
 const denied=await callTool("save_event",{event_id:"e",confirmed:true,idempotency_key:"1234567890123456"},{authContext:{authenticated:false,scopes:[]}});
 assert.equal(denied.isError,true); assert.match(denied.content[0].text,/authentication_required/);
});

test("write tool forwards token, confirmation and idempotency key",async()=>{
 let seen; const fetch=async(url,init)=>{seen={url:String(url),init};return new Response(JSON.stringify({saved:true,created:true,event_id:"e"}),{status:200});};
 const result=await callTool("save_event",{event_id:"e",confirmed:true,idempotency_key:"1234567890123456"},{fetch,config:{apiBaseUrl:"https://api.dizko.app",apiTimeoutMs:1000},authContext:{authenticated:true,subject:"u1",clientId:"muse",token:"access",scopes:["saved:write"]}});
 assert.equal(result.isError,false); assert.equal(seen.url,"https://api.dizko.app/connector/v1/saved-events"); assert.equal(seen.init.headers.Authorization,"Bearer access"); assert.equal(seen.init.headers["Idempotency-Key"],"1234567890123456");
});
