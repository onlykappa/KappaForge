// Open-Meteo: https://open-meteo.com/en/docs and /en/docs/geocoding-api.
// No provider key, model inference or paid API. Device coordinates arrive only with the one weather message the
// owner allowed them for (the app asks once, on the first weather question that names no city); they are not stored.
const cache=new Map(),TTL=300000,MAX_CACHE=64;
export const weatherTools=Object.freeze([{name:"weather",description:"Current weather, hourly and seven-day forecasts by city or explicit coordinates"}]);
export class WeatherError extends Error{constructor(message,status=502){super(message);this.status=status;}}
const finite=n=>typeof n==="number"&&Number.isFinite(n);
function coordinates(lat,lon){return finite(lat)&&finite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;}
export function weatherRequest(text){
 text=String(text||"").trim();
 if(/\b(?:implement|repair|debug|code|endpoint|unit test|pull request)\b/i.test(text))return false;
 return /^(?:what(?:'s| is)|how(?:'s| is)|will|is it|do i need|show|give|tell|weather\b|forecast\b|seven.day\b|7.day\b)/i.test(text)&&/\b(?:weather|forecast|rain|snow|temperature|wind|umbrella)\b/i.test(text);
}
export function weatherArguments(text,preferences={},location=null){
 const match=String(text).match(/\b(?:in|for)\s+(.+?)(?=[?!]|$)/i);
 let city=(match?.[1]||"").replace(/\s+(?:today|tomorrow|right now|this week|in (?:fahrenheit|celsius)).*$/i,"").trim();
 if(/^(?:today|tomorrow|this week|the next|celsius|fahrenheit)\b/i.test(city))city="";
 const explicitUnits=/\b(?:fahrenheit|celsius)\b/i.exec(text)?.[0]?.toLowerCase();
 const units=explicitUnits||preferences.weatherUnits||"auto";
 const args={city:city||preferences.weatherCity||"",units:units==="auto"?(/^en-US\b/i.test(preferences.locale||preferences.language||"")?"fahrenheit":"celsius"):units};
 // A typed city, then the saved default city, then this message's device location.
 if(!args.city&&location&&typeof location==="object"&&!Array.isArray(location)){
  const round=n=>typeof n==="number"?Math.round(n*100)/100:n;
  args.latitude=round(location.latitude);args.longitude=round(location.longitude);
 }
 return args;
}
async function getJSON(url,{fetcher,signal}){
 try{
  const response=await fetcher(url,{signal,headers:{Accept:"application/json"}});
  if(!response.ok)throw new WeatherError("Weather service is unavailable. Please try again later.");
  return await response.json();
 }catch(error){if(error instanceof WeatherError)throw error;throw new WeatherError("Weather service timed out or returned invalid data. Please try again later.");}
}
export async function invokeWeatherTool(name,input={},options={}){
 if(name!=="weather")throw new WeatherError("Unknown weather tool",400);
 if(!input||typeof input!=="object"||Array.isArray(input))throw new WeatherError("Invalid weather request",400);
 const {fetcher=fetch,now=Date.now,signal,store=cache}=options;
 const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000);
 if(requestSignal.aborted)throw new WeatherError("Weather request cancelled.",499);
 const units=input.units??"celsius";
 if(!["celsius","fahrenheit"].includes(units))throw new WeatherError("Choose Celsius or Fahrenheit.",400);
 let lat=input.latitude,lon=input.longitude,location;
 const hasCoordinates=lat!==undefined||lon!==undefined;
 if(hasCoordinates&&!coordinates(lat,lon))throw new WeatherError("Invalid latitude or longitude.",400);
 const city=typeof input.city==="string"?input.city.trim():"";
 if(input.city!==undefined&&(typeof input.city!=="string"||city.length>120))throw new WeatherError("Invalid city name.",400);
 if(!city&&!hasCoordinates)throw new WeatherError("Which city should I check? You can also save a default city in Settings → Personalization.",400);
 const key=JSON.stringify([city.toLowerCase(),hasCoordinates?lat:null,hasCoordinates?lon:null,units]);
 const at=now();
 for(const [k,row] of store)if(at-row.fetchedAt>=TTL)store.delete(k);
 const hit=store.get(key);if(hit)return {...structuredClone(hit),cached:true};
 if(city){
  const url=new URL("https://geocoding-api.open-meteo.com/v1/search");url.search=new URLSearchParams({name:city,count:"1",language:"en",format:"json"});
  const geo=await getJSON(url,{fetcher,signal:requestSignal});const found=geo?.results?.[0];
  if(!found||!coordinates(found.latitude,found.longitude)||typeof found.name!=="string")throw new WeatherError("I couldn't find that city. Please include its state or country.",404);
  lat=found.latitude;lon=found.longitude;location=[found.name,found.admin1,found.country].filter(x=>typeof x==="string"&&x).join(", ");
 }else location=`Your location (${lat}, ${lon})`;
 const url=new URL("https://api.open-meteo.com/v1/forecast");
 url.search=new URLSearchParams({latitude:String(lat),longitude:String(lon),current:"temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m",hourly:"temperature_2m,precipitation_probability,wind_speed_10m",daily:"weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",temperature_unit:units,wind_speed_unit:units==="fahrenheit"?"mph":"kmh",timezone:"auto",forecast_days:"7"});
 const data=await getJSON(url,{fetcher,signal:requestSignal});
 const c=data?.current,h=data?.hourly,d=data?.daily;
 const times=(v,n)=>Array.isArray(v)&&v.length>=n&&v.every(t=>typeof t==="string"&&/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(t));
 const values=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(x=>x===null||finite(x));
 if(!c||!finite(c.temperature_2m)||!finite(c.weather_code)||!finite(c.wind_speed_10m)||typeof c.time!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(c.time)||typeof data.timezone!=="string"||!times(h?.time,24)||!times(d?.time,7)||!values(h.temperature_2m,h.time.length)||!values(d.temperature_2m_max,d.time.length)||!values(d.temperature_2m_min,d.time.length))throw new WeatherError("Weather service returned incomplete conditions or forecasts. Please try again later.");
 try{new Intl.DateTimeFormat("en",{timeZone:data.timezone});}catch{throw new WeatherError("Weather service returned an invalid timezone.");}
 const probability=x=>finite(x)&&x>=0&&x<=100?x:null;
 const result={tool:"weather",source:"Open-Meteo",location,latitude:lat,longitude:lon,timezone:data.timezone,units,fetchedAt:at,cached:false,
  current:{time:c.time,temperature:c.temperature_2m,feelsLike:finite(c.apparent_temperature)?c.apparent_temperature:null,code:c.weather_code,wind:c.wind_speed_10m,direction:finite(c.wind_direction_10m)?c.wind_direction_10m:null},
  hourly:h.time.map((time,i)=>({time,temperature:h.temperature_2m[i],rain:probability(h.precipitation_probability?.[i]),wind:finite(h.wind_speed_10m?.[i])?h.wind_speed_10m[i]:null})),
  daily:d.time.slice(0,7).map((date,i)=>({date,low:d.temperature_2m_min[i],high:d.temperature_2m_max[i],rain:probability(d.precipitation_probability_max?.[i]),wind:finite(d.wind_speed_10m_max?.[i])?d.wind_speed_10m_max[i]:null}))};
 if(store.size>=MAX_CACHE)store.delete(store.keys().next().value);store.set(key,result);return structuredClone(result);
}
const condition=code=>code===0?"clear":code<=3?"partly cloudy or overcast":code<=48?"fog":code<=67?"rain or drizzle":code<=77?"snow":code<=86?"showers":"thunderstorms";
export function formatWeather(data,text=""){
 const unit=data.units==="fahrenheit"?"°F":"°C",windUnit=data.units==="fahrenheit"?"mph":"km/h";
 const value=x=>finite(x)?Math.round(x):"unavailable";
 let reply=`${data.location}: ${condition(data.current.code)}, ${value(data.current.temperature)}${unit}${finite(data.current.feelsLike)?` (feels like ${value(data.current.feelsLike)}${unit})`:""}; wind ${value(data.current.wind)} ${windUnit}.\nConditions at ${data.current.time.replace("T"," ")} (${data.timezone}). Source: Open-Meteo${data.cached?" · cached for up to 5 minutes":""}.`;
 const forecast=/\b(?:seven|7)[ -]day|week/i.test(text)?data.daily:[data.daily[/tomorrow/i.test(text)?1:0]];
 reply+="\n\n"+forecast.filter(Boolean).map(day=>`${day.date}: ${value(day.low)}–${value(day.high)}${unit}; rain ${day.rain===null?"unavailable":day.rain+"%"}; wind ${value(day.wind)} ${windUnit}.`).join("\n");
 if(/hour/i.test(text))reply+="\n\nHourly (local):\n"+data.hourly.filter(h=>h.time>=data.current.time).slice(0,6).map(h=>`${h.time.replace("T"," ")}: ${value(h.temperature)}${unit}, rain ${h.rain===null?"unavailable":h.rain+"%"}`).join("\n");
 return reply;
}
