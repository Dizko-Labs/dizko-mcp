import { getConfig } from "./config.js";
export async function recordToolCall(fact,options={}) {
 const config={...getConfig(options.env),...(options.config||{})};
 if(!config.upstreamSecret)return;
 try { await (options.fetch||fetch)(`${config.apiBaseUrl}/connector/v1/tool-calls`,{method:"POST",signal:AbortSignal.timeout(Math.min(config.apiTimeoutMs,2000)),headers:{"Content-Type":"application/json","X-Dizko-MCP-Secret":config.upstreamSecret},body:JSON.stringify(fact)}); } catch { /* telemetry never breaks a tool call */ }
}
export function cityFromInput(input={}) { const city=typeof input.city==="string"?input.city.trim().toLowerCase():""; return city.slice(0,100)||null; }
