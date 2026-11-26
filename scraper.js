import fs from "node:fs";

const LAT = 19.2000;
const LON = -96.1400;
const TZ = "America/Mexico_City";
const BASE = "https://api.open-meteo.com/v1/forecast";
const params = new URLSearchParams({
  latitude: LAT, longitude: LON, timezone: TZ, forecast_days: 7,
  current: [
    "temperature_2m","apparent_temperature","relative_humidity_2m","is_day",
    "precipitation","weather_code","pressure_msl","wind_speed_10m",
    "wind_direction_10m","wind_gusts_10m"
  ].join(","),
  hourly: [
    "temperature_2m","apparent_temperature","relative_humidity_2m",
    "dew_point_2m","precipitation_probability","precipitation","weather_code",
    "cloud_cover","visibility","wind_speed_10m","wind_direction_10m",
    "wind_gusts_10m","pressure_msl","uv_index","is_day"
  ].join(","),
  daily: [
    "weather_code","temperature_2m_max","temperature_2m_min","precipitation_sum",
    "precipitation_probability_max","wind_speed_10m_max","wind_gusts_10m_max",
    "wind_direction_10m_dominant","sunrise","sunset","uv_index_max"
  ].join(","),
  wind_speed_unit: "kmh", temperature_unit: "celsius", precipitation_unit: "mm"
});
const url = `${BASE}?${params}`;

async function fetchWithRetry(resource, options = {}, { attempts = 3, timeoutMs = 30000, label = "API" } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(resource, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.ok) return response;
      const error = new Error(`${label} HTTP ${response.status}`);
      if (response.status < 500 && response.status !== 429) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (error.name !== "TimeoutError" && error.name !== "AbortError" &&
          !/fetch failed|ConnectTimeoutError|ECONNRESET|ETIMEDOUT|HTTP 429|HTTP 5\d\d/i.test(error.message)) {
        throw error;
      }
    }
    if (attempt < attempts) {
      const waitMs = attempt * 3000;
      console.warn(`${label}: intento ${attempt}/${attempts} falló (${lastError.message}). Reintentando en ${waitMs/1000}s…`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  throw new Error(`${label}: no respondió después de ${attempts} intentos. Último error: ${lastError?.message || "desconocido"}`);
}

const response = await fetchWithRetry(url, {
  headers: { "User-Agent": "CLIMAPUERTO/1.0 (weather dashboard)" }
}, { attempts: 3, timeoutMs: 30000, label: "Open-Meteo forecast" });
const raw = await response.json();
if (raw.error || !raw.current || !raw.hourly || !raw.daily) throw new Error(raw.reason || "Open-Meteo devolvió datos incompletos.");

const airUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
airUrl.search = new URLSearchParams({
  latitude: LAT, longitude: LON, timezone: TZ, forecast_days: 5,
  hourly: "european_aqi,us_aqi,pm10,pm2_5,ozone,nitrogen_dioxide"
});
let airRaw = null;
try {
  const ar = await fetchWithRetry(airUrl, {}, {
    attempts: 2, timeoutMs: 20000, label: "Open-Meteo air quality"
  });
  airRaw = await ar.json();
} catch (error) {
  console.warn("Air-quality endpoint unavailable; continuing without it:", error.message);
}
const codeText = code => ({
  0:"Despejado",1:"Principalmente despejado",2:"Nubes y claros",3:"Nublado",
  45:"Niebla",48:"Niebla engelante",51:"Llovizna ligera",53:"Llovizna",
  55:"Llovizna intensa",56:"Llovizna helada",57:"Llovizna helada intensa",
  61:"Lluvia ligera",63:"Lluvia",65:"Lluvia intensa",66:"Lluvia helada",
  67:"Lluvia helada intensa",71:"Nevada ligera",73:"Nevada",75:"Nevada intensa",
  77:"Granos de nieve",80:"Chubascos ligeros",81:"Chubascos",82:"Chubascos intensos",
  85:"Chubascos de nieve",86:"Chubascos de nieve intensos",95:"Tormenta eléctrica",
  96:"Tormenta con granizo",99:"Tormenta intensa con granizo"
})[code] || "Condición variable";
const direction = deg => {
  if (deg == null || !Number.isFinite(Number(deg))) return null;
  return ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"][Math.round(Number(deg)/22.5)%16];
};
const fmtDay = date => new Date(date + "T12:00:00").toLocaleDateString("es-MX", {weekday:"long",day:"numeric",month:"short",timeZone:TZ});
const c = raw.current, h = raw.hourly, d = raw.daily;
const hourIndex = new Map();
(h.time || []).forEach((time,i) => { if (!hourIndex.has(time)) hourIndex.set(time,i); });
const hours = [...hourIndex.entries()].map(([time,i]) => {
  const deg=h.wind_direction_10m?.[i];
  return {
    hora: time.slice(11,16), timestamp:time, condicion:codeText(h.weather_code?.[i]),
    temp:h.temperature_2m?.[i], sensacion:h.apparent_temperature?.[i],
    probLluvia:h.precipitation_probability?.[i], lluviaMm:h.precipitation?.[i],
    humedad:h.relative_humidity_2m?.[i], puntoRocio:h.dew_point_2m?.[i],
    nubosidad:h.cloud_cover?.[i], visibilidadKm:h.visibility?.[i]==null?null:Math.round(h.visibility[i]/100)/10,
    vientoMedio:h.wind_speed_10m?.[i], rachas:h.wind_gusts_10m?.[i],
    presion:h.pressure_msl?.[i], uv:h.uv_index?.[i]==null?null:{indice:h.uv_index[i]},
    isDay:h.is_day?.[i], viento:{dir:direction(deg),min:h.wind_speed_10m?.[i],max:h.wind_gusts_10m?.[i]}
  };
});
const dias = (d.time || []).map((date,i) => ({
  dia:fmtDay(date).split(" ")[0], fecha:date,
  condicion:codeText(d.weather_code?.[i]),
  probLluvia:d.precipitation_probability_max?.[i] ?? null,
  lluviaMm:d.precipitation_sum?.[i] ?? null,
  max:d.temperature_2m_max?.[i], min:d.temperature_2m_min?.[i],
  viento:{dir:direction(d.wind_direction_10m_dominant?.[i]),min:null,max:d.wind_speed_10m_max?.[i]},
  rachas:d.wind_gusts_10m_max?.[i], salida:d.sunrise?.[i], puesta:d.sunset?.[i],
  uvMax:d.uv_index_max?.[i]
}));
const sunrise=d.sunrise?.[0], sunset=d.sunset?.[0];
const hhmm = value => value ? value.slice(11,16) : null;
const duration = sunrise && sunset ? Math.round((new Date(sunset)-new Date(sunrise))/60000) : null;
const fmtDuration = mins => mins==null ? null : `${Math.floor(mins/60)}h ${mins%60}m`;
const current = {
  hora:c.time?.slice(11,16), observacion:c.time || null, condicion:codeText(c.weather_code),
  temp:c.temperature_2m, sensacion:c.apparent_temperature,
  humedad:c.relative_humidity_2m, presion:c.pressure_msl,
  viento:{dir:direction(c.wind_direction_10m),min:c.wind_speed_10m,max:c.wind_gusts_10m},
  rachas:c.wind_gusts_10m, codigo:c.weather_code, isDay:c.is_day,
  precipitacion:c.precipitation
};
let aire = null;
if (airRaw?.hourly) {
  const ah=airRaw.hourly, now=c.time;
  let ai=ah.time?.findIndex(t=>t>=now) ?? -1;
  if(ai<0) ai=0;
  const aqi=ah.european_aqi?.[ai] ?? ah.us_aqi?.[ai] ?? null;
  aire = {indice:aqi,nivel:aqi==null?"Sin datos":aqi<=20?"Bueno":aqi<=40?"Aceptable":aqi<=60?"Moderado":aqi<=80?"Malo":"Muy malo",
    escala:ah.european_aqi?.[ai]!=null?"European AQI":"US AQI",
    pm10:ah.pm10?.[ai]??null,pm25:ah.pm2_5?.[ai]??null,
    ozono:ah.ozone?.[ai]??null,dioxidoNitrogeno:ah.nitrogen_dioxide?.[ai]??null};
}
const data = {
  fuente:"Open-Meteo", fuenteUrl:"https://open-meteo.com/",
  actualizado:new Date().toISOString(), consultado:new Date().toISOString(), ubicacion:"Veracruz, Veracruz, México",
  coordenadas:{latitud:LAT,longitud:LON}, zonaHoraria:TZ, unidades:"°C · km/h · mm",
  actual:current, dias, horas:hours,
  sol:{salida:hhmm(sunrise),puesta:hhmm(sunset),duracion:fmtDuration(duration),
    primeraLuz:null,mediodia:null,ultimaLuz:null,restante:null},
  aire, climaMes:null,
  resumen:{hoy:`En Veracruz: ${current.condicion.toLowerCase()}, ${Math.round(current.temp)}°C; sensación térmica de ${Math.round(current.sensacion)}°C. Viento ${current.viento.dir || "variable"} a ${Math.round(current.viento.min)} km/h, con rachas de ${Math.round(current.viento.max)} km/h.`},
  luna:[], ciudades:[]
};
fs.writeFileSync("data.json",JSON.stringify(data,null,2)+"\n");
fs.writeFileSync("data.js","window.CLIMA="+JSON.stringify(data)+";\\n");


const BITACORA_URL = "https://www.mediport.com.mx/tableroOperativo/TablerosPublicos/bitacoraBahiaPublica.aspx";
const BITACORA_API = BITACORA_URL + "/consultaBitacoraPuertoPublica";
const bitacoraPath = "bitacora.json";
const normBay = value => String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const parseMovementDate = item => {
  const raw=String(item.fecha||"");
  const m=raw.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if(!m)return 0;
  let year=Number(m[3]);if(year<100)year+=2000;
  const tm=String(item.hora||"").match(/(\d{1,2}):(\d{2})/);
  return new Date(year,Number(m[2])-1,Number(m[1]),tm?Number(tm[1]):0,tm?Number(tm[2]):0).getTime()||0;
};
const readPreviousBitacora=()=>{
  try{return fs.existsSync(bitacoraPath)?JSON.parse(fs.readFileSync(bitacoraPath,"utf8").trim().replace(/\\n$/,"")):null;}
  catch{return null;}
};
let bitacora={fuente:BITACORA_URL,actualizado:null,consultado:new Date().toISOString(),disponible:false,obsoleta:false,bahiaNorte:[],bahiaSur:[]};
try{
  const previous=readPreviousBitacora();
  const responseLog=await fetchWithRetry(BITACORA_API,{
    method:"POST",
    headers:{"User-Agent":"Mozilla/5.0 CLIMAPUERTO/1.0","Content-Type":"application/json; charset=utf-8","Accept":"application/json"},
    body:JSON.stringify({pNidApi:1})
  },{attempts:3,timeoutMs:25000,label:"Mediport bitácora API"});
  const payload=await responseLog.json();
  const records=payload?.d?.datos;
  if(Number(payload?.d?.estado)!==1||!Array.isArray(records))throw new Error(payload?.d?.mensaje||"La API pública de Mediport no devolvió registros válidos.");
  const parsed={bahiaNorte:[],bahiaSur:[]};
  for(const row of records){
    const bay=normBay(row.bahia);
    const movement={
      fecha:String(row.fecha||"").split(" ")[0],
      hora:String(row.hora||""),
      evento:String(row.evento||"Movimiento"),
      motivo:String(row.motivo||"")
    };
    if(bay.includes("norte"))parsed.bahiaNorte.push(movement);
    else if(bay.includes("sur"))parsed.bahiaSur.push(movement);
  }
  for(const key of ["bahiaNorte","bahiaSur"])parsed[key]=parsed[key].sort((a,b)=>parseMovementDate(b)-parseMovementDate(a)).slice(0,3);
  bitacora={fuente:BITACORA_URL,actualizado:new Date().toISOString(),consultado:new Date().toISOString(),disponible:true,obsoleta:false,totalRegistros:records.length,...parsed};
  console.log("OK Mediport bitácora API: "+records.length+" registros; Norte "+parsed.bahiaNorte.length+", Sur "+parsed.bahiaSur.length+" movimientos recientes.");
}catch(error){
  const previous=readPreviousBitacora();
  bitacora=previous?{...previous,consultado:new Date().toISOString(),disponible:false,obsoleta:true,error:error.message}:{...bitacora,error:error.message};
  console.warn("Mediport bitácora no disponible; la actualización meteorológica continúa:",error.message);
}

/* Diagnóstico de fuente pública CALT: inspecciona página y recursos embebidos sin asumir estados. */
const CALT_PAGES=[
  "https://calt.puertodeveracruz.com.mx/Calt/",
  "https://calt.puertodeveracruz.com.mx/Calt/Publico/EstadoTerminalesManiobras.aspx"
];
const caltDiagnostics=[];
try{
  for(const pageUrl of CALT_PAGES){
    const response=await fetchWithRetry(pageUrl,{
      headers:{"User-Agent":"Mozilla/5.0 (compatible; CLIMAPUERTO/1.0)","Accept":"text/html,application/xhtml+xml"}
    },{attempts:2,timeoutMs:20000,label:"CALT "+pageUrl});
    const html=await response.text();
    const decode=s=>String(s||"").replace(/&nbsp;|&#160;/gi," ").replace(/&aacute;/gi,"á").replace(/&eacute;/gi,"é").replace(/&iacute;/gi,"í").replace(/&oacute;/gi,"ó").replace(/&uacute;/gi,"ú").replace(/&ntilde;/gi,"ñ").replace(/&amp;/gi,"&").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
    const plain=decode(html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," "));
    const iframes=[...html.matchAll(/<iframe[^>]+src=["']([^"']+)/gi)].map(m=>new URL(m[1],pageUrl).href);
    const scripts=[...html.matchAll(/<script[^>]+src=["']([^"']+)/gi)].map(m=>new URL(m[1],pageUrl).href);
    caltDiagnostics.push({url:pageUrl,status:response.status,title:decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||""),text:plain.slice(0,9000),iframes,scripts});
  }
}catch(error){
  caltDiagnostics.push({error:error.message});
}
console.log("CALT_DIAGNOSTICS "+JSON.stringify(caltDiagnostics));

fs.writeFileSync(bitacoraPath,JSON.stringify(bitacora,null,2)+"\n");

console.log(`OK Open-Meteo: ${dias.length} días, ${hours.length} horas; calidad del aire ${aire?"disponible":"no disponible"}.`);
