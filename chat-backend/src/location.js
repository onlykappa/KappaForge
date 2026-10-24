// Device location for questions that need it ("where am I", "near me"). The app asks the owner once and sends one
// reading with that message only; nothing here stores it. Reverse geocoding: OpenStreetMap Nominatim
// (https://nominatim.org/release-docs/latest/api/Reverse/), one request per question, cached for five minutes.
const cache=new Map(),TTL=300000,MAX_CACHE=32;
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const CODE_WORDS=/\b(?:implement|repair|debug|code|endpoint|unit test|pull request|function|refactor|commit|deploy)\b/i;
// Keep in step with preview/core.js locationQuestion (tests compare them).
const WHERE=/\b(?:where am i|where are we|where i am|my (?:current |exact |precise )?(?:location|coordinates|gps|position|address|lat(?:itude)?|long(?:itude)?)|current location|what (?:city|town|state|country|county|street|neighbou?rhood|zip(?: code)?|postcode) am i in)\b/i;
const NEARBY=/\b(?:near me|close to me|around me|nearby|nearest|closest|around here|near here|from here|from me|my area|this area|how far (?:am i|away am i))\b/i;
// "Where am I in the queue / on task 221 / with the release" asks for status, not a place ("in the world" still is).
const STATUS_WHERE=/\bwhere (?:am i|are we)\s+(?:at\s+)?(?:in|on|at|with)\s+(?:the|my|our|this|task|pr)\b(?!\s+(?:world|map|planet|earth|globe|city|town|country|state)\b)/i;
const PLACE_WORDS=/\bmy (?:current |exact |precise )?(?:location|coordinates|gps|position|address)\b/i;
// "where": the question is the location itself (answered directly). "nearby": the location is context for the model.
const BEYOND=/\b(?:how far|distance|directions?|route|drive|walk|near|nearest|closest|weather|time|restaurants?|food|coffee|gas|hotel|store|shop)\b/i;
export function locationQuestion(text){
 text=String(text||"").trim().replace(/’/g,"'");
 if(!text||CODE_WORDS.test(text))return null;
 if(STATUS_WHERE.test(text)&&!PLACE_WORDS.test(text)&&!NEARBY.test(text))return null;
 if(WHERE.test(text))return BEYOND.test(text)?"nearby":"where";
 return NEARBY.test(text)?"nearby":null;
}
export function deviceLocation(value){
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const {latitude,longitude,accuracy}=value;
 if(!finite(latitude)||!finite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
 return {latitude,longitude,accuracy:finite(accuracy)&&accuracy>=0&&accuracy<1e6?accuracy:null,reduced:value.reduced===true};
}
export async function reversePlace(location,{fetcher=fetch,signal,now=Date.now,store=cache}={}){
 const lat=location.latitude.toFixed(5),lon=location.longitude.toFixed(5),key=lat+","+lon,at=now();
 for(const [k,row] of store)if(at-row.at>=TTL)store.delete(k);
 if(store.has(key))return store.get(key).place;
 const url=new URL("https://nominatim.openstreetmap.org/reverse");
 url.search=new URLSearchParams({format:"jsonv2",lat,lon,zoom:"18",addressdetails:"1"});
 let place=null;
 try{
  const response=await fetcher(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(6000)]):AbortSignal.timeout(6000),
   headers:{Accept:"application/json","User-Agent":"KappaForge/2 (personal assistant; https://github.com/onlykappa/KappaForge)"}});
  if(response.ok){
   const data=await response.json(),a=data?.address||{};
   const street=[a.house_number,a.road].filter(x=>typeof x==="string"&&x).join(" ");
   const city=[a.city,a.town,a.village,a.hamlet,a.suburb].find(x=>typeof x==="string"&&x);
   const parts=[street,a.neighbourhood&&!street?a.neighbourhood:"",city,a.state,a.postcode,a.country].filter(x=>typeof x==="string"&&x);
   place=parts.length?parts.join(", ").slice(0,240):typeof data?.display_name==="string"?data.display_name.slice(0,240):null;
  }
 }catch{place=null}
 if(store.size>=MAX_CACHE)store.delete(store.keys().next().value);
 store.set(key,{at,place});return place;
}
const coordinates=l=>l.latitude.toFixed(6)+", "+l.longitude.toFixed(6);
const accuracyText=l=>l.accuracy===null?"accuracy not reported":"accurate to about "+(l.accuracy<10?Math.max(1,Math.round(l.accuracy)):Math.round(l.accuracy/5)*5).toLocaleString("en-US")+" m";
export function formatWhereAmI(location,place){
 return "You're at **"+coordinates(location)+"** ("+accuracyText(location)+").\n"+
  (location.reduced?"Precise Location is off for KappaForge, so iOS gave an approximate position. Turn it on in Settings → KappaForge → Location → Precise Location.\n":"")+
  (place?"That's at or near: "+place+".\n":"I couldn't look up the street address just now, but the coordinates above are from your device.\n")+
  "\nShared from your device for this question only; not saved.";
}
export function locationEvidence(location,place){
 return "DEVICE LOCATION (shared by the owner's device for this message only; use it to answer, do not ask for it again): latitude "+
  location.latitude.toFixed(6)+", longitude "+location.longitude.toFixed(6)+" ("+accuracyText(location)+(location.reduced?", approximate: iOS Precise Location is off":"")+")"+
  (place?"; nearest address: "+place:"")+". You have no live maps or places search: name places from your own knowledge, say they may be out of date or closed, and give straight-line distances as estimates.";
}
export const NO_LOCATION="I don't have your location for this. Turn on Settings → Personalization → Use my location, or tell me where you are.";
