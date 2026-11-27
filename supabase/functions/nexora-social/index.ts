import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
const PROJECT_ID = "nexora-ai-drama";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
function reply(status:number, body:Record<string,unknown>) { return new Response(JSON.stringify(body),{status,headers:cors}); }
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
  const body=await req.json(), action=String(body.action||""), seriesId=String(body.seriesId||"").trim();
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
  if(action==="like") {
   const {data:existing,error:readError}=await db.from("nexora_social_likes").select("user_id").eq("user_id",userId).eq("series_id",seriesId).maybeSingle();
   if(readError) throw readError;
   if(existing) { const {error}=await db.from("nexora_social_likes").delete().eq("user_id",userId).eq("series_id",seriesId); if(error) throw error; }
   else { const {error}=await db.from("nexora_social_likes").insert({user_id:userId,series_id:seriesId}); if(error&&error.code!=="23505") throw error; }
  } else if(action==="save") {
   const {data:existing,error:readError}=await db.from("nexora_social_saves").select("user_id").eq("user_id",userId).eq("series_id",seriesId).maybeSingle();
   if(readError) throw readError;
   if(existing) { const {error}=await db.from("nexora_social_saves").delete().eq("user_id",userId).eq("series_id",seriesId); if(error) throw error; }
   else { const {error}=await db.from("nexora_social_saves").insert({user_id:userId,series_id:seriesId}); if(error&&error.code!=="23505") throw error; }
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
  const [likes,ownLike,ownSave,comments]=await Promise.all([
   db.from("nexora_social_likes").select("user_id",{count:"exact",head:true}).eq("series_id",seriesId),
   db.from("nexora_social_likes").select("user_id").eq("user_id",userId).eq("series_id",seriesId).maybeSingle(),
   db.from("nexora_social_saves").select("user_id").eq("user_id",userId).eq("series_id",seriesId).maybeSingle(),
   db.from("nexora_social_comments").select("id,user_id,display_name,body,created_at").eq("series_id",seriesId).order("created_at",{ascending:false}).limit(100)
  ]);
  for(const result of [likes,ownLike,ownSave,comments]) if(result.error) throw result.error;
  return reply(200,{seriesId,viewerId:userId,likesCount:likes.count||0,liked:Boolean(ownLike.data),saved:Boolean(ownSave.data),comments:(comments.data||[]).map(item=>({id:item.id,userId:item.user_id,user:item.display_name,text:item.body,createdAt:item.created_at,time:new Date(item.created_at).toLocaleString("en",{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"})+" UTC"}))});
 } catch(error) { console.error("[nexora-social] request failed",error); return reply(500,{error:"Could not complete social action"}); }
});