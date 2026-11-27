const PROJECT_NUMBER = "201389649043";
const APP_ID = "1:201389649043:android:4dd0433ed5959b5e85f166";
const APP_CHECK_JWKS = createRemoteJWKSet(
  new URL("https://firebaseappcheck.googleapis.com/v1/jwks"),
  { cacheMaxAge: 6 * 60 * 60 * 1000 },
);

type NexoraAppCheckStatus = "valid" | "missing" | "invalid";

async function verifyNexoraAppCheck(request: Request): Promise<NexoraAppCheckStatus> {
  const token = (request.headers.get("x-firebase-appcheck") || "").trim();
  if (!token) return "missing";
  try {
    const { payload, protectedHeader } = await jwtVerify(token, APP_CHECK_JWKS, {
      algorithms: ["RS256"],
      issuer: `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,
      audience: `projects/${PROJECT_NUMBER}`,
    });
    if (protectedHeader.typ !== "JWT" || payload.sub !== APP_ID) return "invalid";
    return "valid";
  } catch {
    return "invalid";
  }
}

function enforceNexoraAppCheck(status: NexoraAppCheckStatus): boolean {
  return Deno.env.get("NEXORA_APP_CHECK_ENFORCE") === "true" && status !== "valid";
}

import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
const PROJECT_ID = "nexora-ai-drama";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-firebase-appcheck","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
function reply(status:number, body:Record<string,unknown>) { return new Response(JSON.stringify(body),{status,headers:cors}); }
function cleanName(value:unknown) { const name=String(value||"NEXORA Viewer").replace(/[<>\u0000-\u001f]/g,"").trim().slice(0,40); return name||"NEXORA Viewer"; }
async function readJsonLimited(req:Request,maxBytes=8192):Promise<Record<string,unknown>> {
 const contentType=(req.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
 if(contentType!=="application/json") throw new Error("content_type_required");
 const declared=Number(req.headers.get("content-length")||"0");
 if(Number.isFinite(declared)&&declared>maxBytes) throw new Error("body_too_large");
 if(!req.body) throw new Error("empty_body");
 const reader=req.body.getReader();
 const chunks:Uint8Array[]=[];
 let total=0;
 try {
  while(true) {
   const {done,value}=await reader.read();
   if(done) break;
   total+=value.byteLength;
   if(total>maxBytes) { await reader.cancel(); throw new Error("body_too_large"); }
   chunks.push(value);
  }
 } finally { reader.releaseLock(); }
 const bytes=new Uint8Array(total);
 let offset=0;
 for(const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
 const parsed=JSON.parse(new TextDecoder().decode(bytes));
 if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)) throw new Error("invalid_json_object");
 return parsed as Record<string,unknown>;
}
async function hashClientNetwork(req: Request, secret: string): Promise<string | null> {
 // Supabase's hosted gateway exposes the Cloudflare-observed client address here.
 // Do not fall back to caller-controlled X-Forwarded-For values.
 const clientIp = (req.headers.get("cf-connecting-ip") || "").trim();
 if (!clientIp || clientIp.length > 64 || /[\s,]/.test(clientIp)) return null;
 const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
 );
 const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(clientIp));
 return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return reply(405,{error:"POST required"});
 const appCheckStatus=await verifyNexoraAppCheck(req);
 if(enforceNexoraAppCheck(appCheckStatus)) return reply(401,{error:"A valid NEXORA app attestation is required"});
 if(appCheckStatus!=="valid") console.info("[NEXORA App Check] Social request attestation status:",appCheckStatus);
 try {
  const match=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i);
  if(!match) return reply(401,{error:"Firebase sign-in required"});
  const {payload}=await jwtVerify(match[1],JWKS,{issuer:`https://securetoken.google.com/${PROJECT_ID}`,audience:PROJECT_ID});
  const userId=String(payload.sub||"");
  if(!userId||userId.length>128) return reply(401,{error:"Invalid Firebase user"});
  const body=await readJsonLimited(req), action=String(body.action||""), seriesId=String(body.seriesId||"").trim();
  // Every valid action returns a social snapshot (including the comment page),
  // so limiting only action=read lets like/save/comment requests bypass the
  // per-user read budget while still triggering the same database reads.
  if(["read","like","save","comment"].includes(action)) {
   const rateUrl=Deno.env.get("SUPABASE_URL"), rateKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
   if(!rateUrl||!rateKey) return reply(503,{error:"Social service is temporarily unavailable"});
   const networkHash=await hashClientNetwork(req,rateKey);
   if(!networkHash) {
    console.error("[nexora-social] trusted client network address unavailable");
    return reply(503,{error:"Social requests are temporarily unavailable"});
   }
   const rateDb=createClient(rateUrl,rateKey,{auth:{persistSession:false,autoRefreshToken:false}});
   const {data:allowed,error:rateError}=await rateDb.rpc("nexora_check_social_request_rate_limit",{
    p_user_id:userId,
    p_network_hash:networkHash,
    p_action:action
   });
   if(rateError) {
    console.error("[nexora-social] request rate-limit check failed",rateError.code||"unknown");
    return reply(503,{error:"Social requests are temporarily unavailable"});
   }
   if(allowed!==true) return new Response(JSON.stringify({error:"Too many social requests. Please try again in one minute."}),{status:429,headers:{...cors,"Retry-After":"60"}});
  }
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(seriesId)) {
   return reply(400,{error:"A valid published drama ID is required"});
  }
  const firebaseClaims=(payload.firebase||{}) as Record<string,unknown>;
  const anonymous=firebaseClaims.sign_in_provider==="anonymous";
  if(anonymous&&action!=="read") return reply(401,{error:"Sign in to an account to like, comment or save posts"});
  if(!["read","like","save","comment"].includes(action)) return reply(400,{error:"Unsupported social action"});
  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) return reply(500,{error:"Social service is not configured"});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  // The service-role client bypasses RLS, so explicitly authorize the target
  // against the public catalog before reading or mutating social records.
  const {data:publishedDrama,error:publishedDramaError}=await db.from("ai_dramas")
   .select("id").eq("id",seriesId).eq("status","published").maybeSingle();
  if(publishedDramaError) throw publishedDramaError;
  if(!publishedDrama) return reply(404,{error:"Published drama not found"});
  if(action==="like" || action==="save") {
   // Serialize each viewer/series/reaction toggle in PostgreSQL. A client-side
   // read followed by insert/delete can race when a user taps rapidly or sends
   // requests from multiple devices.
   const {error}=await db.rpc("nexora_toggle_social_reaction",{
    p_user_id:userId,
    p_series_id:seriesId,
    p_reaction:action
   });
   if(error) throw error;
  } else if(action==="comment") {
   const comment=String(body.comment||"").trim().slice(0,500);
   if(!comment) return reply(400,{error:"Comment cannot be empty"});
   const email=typeof payload.email==="string"?payload.email:"";
   const safeName=payload.name || (email?email.split("@")[0]:"NEXORA Viewer");
   const {data:created,error}=await db.rpc("nexora_create_social_comment",{
    p_user_id:userId,
    p_display_name:cleanName(safeName),
    p_series_id:seriesId,
    p_body:comment
   });
   if(error) throw error;
   if(created!==true) return reply(429,{error:"Please wait before posting another comment"});
  }
  const cursorCreatedAt=typeof body.cursorCreatedAt==="string"?body.cursorCreatedAt:"";
  const cursorId=typeof body.cursorId==="string"?body.cursorId:"";
  if(Boolean(cursorCreatedAt)!==Boolean(cursorId)) return reply(400,{error:"Invalid comment pagination cursor"});
  if(cursorCreatedAt && (!Number.isFinite(Date.parse(cursorCreatedAt)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursorId))) return reply(400,{error:"Invalid comment pagination cursor"});
  const [likes,ownLike,ownSave]=await Promise.all([
   db.from("nexora_social_likes").select("user_id",{count:"exact",head:true}).eq("series_id",seriesId),
   db.from("nexora_social_likes").select("user_id").eq("user_id",userId).eq("series_id",seriesId).maybeSingle(),
   db.from("nexora_social_saves").select("user_id").eq("user_id",userId).eq("series_id",seriesId).maybeSingle()
  ]);
  for(const result of [likes,ownLike,ownSave]) if(result.error) throw result.error;
  let commentsQuery=db.from("nexora_social_comments").select("id,user_id,display_name,body,created_at")
   .eq("series_id",seriesId).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(21);
  if(cursorCreatedAt) commentsQuery=commentsQuery.or(`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`);
  const {data:commentRows,error:commentsError}=await commentsQuery;
  if(commentsError) throw commentsError;
  const rows=commentRows||[];
  const hasMore=rows.length>20;
  const page=rows.slice(0,20);
  const last=page[page.length-1];
  return reply(200,{seriesId,viewerId:userId,likesCount:likes.count||0,liked:Boolean(ownLike.data),saved:Boolean(ownSave.data),
   comments:page.map(item=>({id:item.id,userId:item.user_id,user:item.display_name,text:item.body,createdAt:item.created_at,time:new Date(item.created_at).toLocaleString("en",{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"})+" UTC"})),
   hasMore,nextCursor:hasMore&&last?{createdAt:last.created_at,id:last.id}:null});
 } catch(error) {
  console.error("[nexora-social] request failed",error);
  const message=error instanceof Error?error.message:"";
  if(message==="body_too_large") return reply(413,{error:"Request body is too large"});
  if(message==="content_type_required") return reply(415,{error:"Content-Type application/json is required"});
  if(message==="empty_body"||message==="invalid_json_object"||error instanceof SyntaxError) return reply(400,{error:"A valid JSON object is required"});
  return reply(500,{error:"Could not complete social action"});
 }
});