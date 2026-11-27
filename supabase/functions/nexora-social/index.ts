import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
const PROJECT_ID = "nexora-ai-drama";
const APP_CHECK_PROJECT_NUMBER = "201389649043";
const APP_CHECK_ALLOWED_APP_IDS = new Set([
 "1:201389649043:web:fd6846443425fbe885f166",
 "1:201389649043:android:4dd0433ed5959b5e85f166"
]);
const MAX_APP_CHECK_TOKEN_LENGTH = 8192;
const SOCIAL_COMMENT_PAGE_SIZE = 30;
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const APP_CHECK_JWKS = createRemoteJWKSet(new URL("https://firebaseappcheck.googleapis.com/v1/jwks"));
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-firebase-appcheck","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
function reply(status:number, body:Record<string,unknown>, extraHeaders:Record<string,string>={}) { return new Response(JSON.stringify(body),{status,headers:{...cors,...extraHeaders}}); }
async function checkAppCheck(req:Request):Promise<boolean> {
 const required=Deno.env.get("NEXORA_APP_CHECK_ENFORCE")==="true";
 const token=(req.headers.get("x-firebase-appcheck")||"").trim();
 if(token.length>MAX_APP_CHECK_TOKEN_LENGTH) {
  console.warn("[nexora-social] Oversized App Check token rejected.");
  return !required;
 }
 if(!token) {
  if(required) return false;
  return true; // Compatibility mode: legacy clients continue while App Check rollout is measured.
 }
 try {
  const {payload,protectedHeader}=await jwtVerify(token,APP_CHECK_JWKS,{
   issuer:`https://firebaseappcheck.googleapis.com/${APP_CHECK_PROJECT_NUMBER}`,
   audience:`projects/${APP_CHECK_PROJECT_NUMBER}`,
   algorithms:["RS256"]
  });
  const subject=String(payload.sub||"");
  if(protectedHeader.typ!=="JWT" || !APP_CHECK_ALLOWED_APP_IDS.has(subject)) throw new Error("Unexpected App Check app identity");
  return true;
 } catch(error) {
  console.warn("[nexora-social] App Check token rejected in compatibility mode:",error);
  return !required;
 }
}
function validClientIp(ip:string) {
 const value=ip.trim();
 if(value.length>45) return false;
 if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return value.split(".").every(part=>Number(part)>=0&&Number(part)<=255);
 if(value.toLowerCase().startsWith("::ffff:") && value.includes(".")) return validClientIp(value.slice(7));
 return value.includes(":") && /^[0-9a-fA-F:]+$/.test(value);
}
async function trustedNetworkHash(req:Request):Promise<string|null> {
 // Cloudflare overwrites cf-connecting-ip at the trusted edge; x-real-ip is the gateway fallback.
 const clientIp=(req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||"").trim();
 if(!validClientIp(clientIp)) return null;
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(clientIp.toLowerCase()));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}
function cleanName(value:unknown) { const name=String(value||"NEXORA Viewer").replace(/[<>\u0000-\u001f]/g,"").trim().slice(0,40); return name||"NEXORA Viewer"; }
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return reply(405,{error:"POST required"});
 try {
  const match=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i);
  if(!match) return reply(401,{error:"Firebase sign-in required"});
  const {payload}=await jwtVerify(match[1],JWKS,{issuer:`https://securetoken.google.com/${PROJECT_ID}`,audience:PROJECT_ID});
  const userId=String(payload.sub||"");
  if(!userId||userId.length>128) return reply(401,{error:"Invalid Firebase user"});
  if(!await checkAppCheck(req)) return reply(401,{error:"A valid app attestation is required"});
  const body=await req.json(), action=String(body.action||""), seriesId=String(body.seriesId||"").trim();
  const cursorCreatedAt=body.cursorCreatedAt==null?"":String(body.cursorCreatedAt);
  const cursorId=body.cursorId==null?"":String(body.cursorId);
  const hasCursor=Boolean(cursorCreatedAt||cursorId);
  if(hasCursor && (action!=="read" || !cursorCreatedAt || !cursorId ||
    !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2})$/.test(cursorCreatedAt) ||
    !Number.isFinite(Date.parse(cursorCreatedAt)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursorId))) {
   return reply(400,{error:"Invalid comment pagination cursor"});
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
  const networkHash=await trustedNetworkHash(req);
  if(!networkHash) return reply(503,{error:"Secure request network metadata unavailable"});
  const {data:rateAllowed,error:rateError}=await db.rpc("nexora_check_social_request_rate_limit",{p_user_id:userId,p_network_hash:networkHash,p_action:action});
  if(rateError) throw rateError;
  if(rateAllowed!==true) return reply(429,{error:"Too many social requests. Please try again shortly."},{"Retry-After":"60"});
  // The service-role client bypasses RLS, so explicitly authorize the target
  // against the public catalog before reading or mutating social records.
  const {data:publishedDrama,error:publishedDramaError}=await db.from("ai_dramas")
   .select("id").eq("id",seriesId).eq("status","published").maybeSingle();
  if(publishedDramaError) throw publishedDramaError;
  if(!publishedDrama) return reply(404,{error:"Published drama not found"});
  if(action==="like" || action==="save") {
   const {error}=await db.rpc("nexora_toggle_social_reaction",{p_user_id:userId,p_series_id:seriesId,p_reaction:action});
   if(error) throw error;
  } else if(action==="comment") {
   const comment=String(body.comment||"").trim().slice(0,500);
   if(!comment) return reply(400,{error:"Comment cannot be empty"});
   const email=typeof payload.email==="string"?payload.email:"";
   const safeName=payload.name || (email?email.split("@")[0]:"NEXORA Viewer");
   const {data:created,error}=await db.rpc("nexora_create_social_comment",{p_user_id:userId,p_display_name:cleanName(safeName),p_series_id:seriesId,p_body:comment});
   if(error) throw error;
   if(created!==true) return reply(429,{error:"Please wait before posting another comment."},{"Retry-After":"60"});
  }
  let commentsQuery=db.from("nexora_social_comments").select("id,user_id,display_name,body,created_at")
   .eq("series_id",seriesId).order("created_at",{ascending:false}).order("id",{ascending:false})
   .limit(SOCIAL_COMMENT_PAGE_SIZE+1);
  if(hasCursor) commentsQuery=commentsQuery.or(`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`);
  const [likes,ownLike,ownSave,comments]=await Promise.all([
   db.from("nexora_social_likes").select("user_id",{count:"exact",head:true}).eq("series_id",seriesId),
   db.from("nexora_social_likes").select("user_id").eq("user_id",userId).eq("series_id",seriesId).maybeSingle(),
   db.from("nexora_social_saves").select("user_id").eq("user_id",userId).eq("series_id",seriesId).maybeSingle(),
   commentsQuery
  ]);
  for(const result of [likes,ownLike,ownSave,comments]) if(result.error) throw result.error;
  const commentRows=comments.data||[];
  const hasMoreComments=commentRows.length>SOCIAL_COMMENT_PAGE_SIZE;
  const pageComments=commentRows.slice(0,SOCIAL_COMMENT_PAGE_SIZE);
  const lastComment=pageComments[pageComments.length-1];
  const nextCursor=hasMoreComments&&lastComment?{createdAt:lastComment.created_at,id:lastComment.id}:null;
  return reply(200,{seriesId,viewerId:userId,likesCount:likes.count||0,liked:Boolean(ownLike.data),saved:Boolean(ownSave.data),comments:pageComments.map(item=>({id:item.id,userId:item.user_id,user:item.display_name,text:item.body,createdAt:item.created_at,time:new Date(item.created_at).toLocaleString("en",{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"})+" UTC"})),hasMoreComments,nextCursor});
 } catch(error) { console.error("[nexora-social] request failed",error); return reply(500,{error:"Could not complete social action"}); }
});