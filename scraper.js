import * as cheerio from "cheerio";
import fs from "fs";

const URL = "https://www.meteored.mx/clima_Veracruz-America+Norte-Mexico-Veracruz-MMVR-1-22291.html";
const clean = s => (s || "").replace(/\s+/g, " ").trim();
const m = (t, re) => { const r = t.match(re); return r ? r.slice(1) : []; };

const res = await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept-Language": "es-MX,es;q=0.9" } });
if (!res.ok) throw new Error("HTTP " + res.status);
const $ = cheerio.load(await res.text());
$("script,style,noscript").remove();
const body = clean($("body").text());

// Actual
const [temp, feels] = m(body, /(-?\d+)°\s*Sensación de\s*(-?\d+)°/);
const [windDir, wMin, wMax] = m(body, /Sensación de\s*-?\d+°\s*([A-Za-zñáéíóú]+)\s*(\d+)\s*-\s*(\d+)\s*km\/h/);
const current = {
  hora: m(body, /(\d{1,2}:\d{2})\s+\w+ /)[0] || null,
  condicion: clean($("h1").first().parent().find("img[alt]").first().attr("alt")) || null,
  temp: +temp || null, sensacion: +feels || null,
  viento: windDir ? { dir: windDir, min: +wMin, max: +wMax } : null,
};

// Pronóstico diario (1-7 días)
const dias = [];
$("li").each((_, li) => {
  const t = clean($(li).text());
  const d = t.match(/^(Hoy|Mañana|Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo)\s+(\d{1,2}\s+\w{3})\s*(?:(\d+)%\s*([\d.]+)\s*mm)?\s*(-?\d+)°\s*\/\s*(-?\d+)°\s*(\d+)\s*-\s*(\d+)\s*km\/h/);
  if (!d) return;
  const imgs = $(li).find("img[alt]").map((_, i) => $(i).attr("alt")).get();
  dias.push({ dia: d[1], fecha: d[2], condicion: imgs[0] || null, probLluvia: d[3] ? +d[3] : 0, lluviaMm: d[4] ? +d[4] : 0,
    max: +d[5], min: +d[6], viento: { dir: imgs[1] || null, min: +d[7], max: +d[8] } });
});

// Pronóstico por hora (detalle)
const horas = [];
const num = (t, re) => { const r = t.match(re); return r ? +r[1] : null; };
$("tr").each((_, tr) => {
  let t = clean($(tr).text());
  if (!/Sensación T\./.test(t)) return;
  const next = clean($(tr).next().text());
  if (/Humedad/.test(next) && !/Sensación T\./.test(next)) t += " " + next;
  const h = t.match(/(\d{1,2}:\d{2})\s*(?:(\d+)%\s*([\d.]+)\s*mm)?\s*(-?\d+)°\s*(.+?)\s*Sensación T\.\s*(-?\d+)°/);
  if (!h) return;
  const uv = t.match(/(\d+)\s+(Bajo|Medio|Moderado|Alto|Muy alto|Extremo)/);
  const w = t.match(/([A-Za-zñáéíóú]+)\s+(\d+)\s*-\s*(\d+)\s*km\/h/);
  horas.push({ hora: h[1], condicion: clean(h[5]), temp: +h[4], sensacion: +h[6],
    probLluvia: num(t, /Lluvia\s*(\d+)%/), lluviaMm: num(t, /Lluvia\s*\d+%\s*([\d.]+)\s*mm/),
    humedad: num(t, /Humedad\s*(\d+)%/), puntoRocio: num(t, /Punto de rocío\s*(-?\d+)/),
    nubosidad: num(t, /Nubosidad\s*(\d+)%/), visibilidadKm: num(t, /Visibilidad\s*(\d+)/),
    vientoMedio: num(t, /Viento - Medio\s*(\d+)/), rachas: num(t, /Rachas\s*(\d+)/),
    presion: num(t, /Presión\s*(\d+)/), niebla: (t.match(/Niebla\s*(Sí|No)/) || [])[1] || null,
    cotaNieve: num(t, /Cota Nieve\s*(\d+)/),
    uv: uv ? { indice: +uv[1], nivel: uv[2] } : null,
    viento: w ? { dir: w[1], min: +w[2], max: +w[3] } : null });
});

// Sol, aire, clima del mes, resúmenes
const sol = {
  salida: m(body, /Salida del sol\s*(\d{1,2}:\d{2})/)[0], puesta: m(body, /Puesta del sol\s*(\d{1,2}:\d{2})/)[0],
  primeraLuz: m(body, /Primera luz\s*(\d{1,2}:\d{2})/)[0], mediodia: m(body, /Mediodía\s*(\d{1,2}:\d{2})/)[0],
  ultimaLuz: m(body, /Última luz\s*(\d{1,2}:\d{2})/)[0], duracion: m(body, /Duración del día\s*(\d+h \d+m)/)[0],
  restante: m(body, /Luz diurna restante\s*(\d+h \d+m)/)[0],
};
const [aqi, aqiN, aqiC, aqiV] = m(body, /Calidad del aire[^0-9]*?(\d+)\s*([A-Za-zñáéíóú ]+?)\s+([A-Za-z0-9₂₃.]+)\s*\((\d+)\s*µg\/m³\)/);
const aire = aqi ? { indice: +aqi, nivel: clean(aqiN), contaminante: aqiC, ugm3: +aqiV } : null;
const [mes] = m(body, /¿Qué tiempo hace en Veracruz en (\w+)\?/);
const [tm, mx, mn] = m(body, /T\. Media:\s*(-?\d+)\s*°C\s*Max\.:\s*(-?\d+)\s*°C\s*Min:\s*(-?\d+)/);
const climaMes = { mes: mes || null, tMedia: +tm || null, max: +mx || null, min: +mn || null,
  diasLluvia: +m(body, /Días de lluvia:\s*(\d+)/)[0] || null, lluviaAcum: +m(body, /Acum\. de lluvia:\s*(\d+)/)[0] || null,
  vientoMedio: +m(body, /Viento medio:\s*(\d+)/)[0] || null };
const resumen = {
  hoy: m(body, /(Hoy en Veracruz,.*?)(?=Pronóstico en Veracruz|$)/)[0] || null,
};

// Luna
const luna = [];
$("h4").filter((_, e) => /Calendario lunar/.test($(e).text())).nextAll("table").first().find("td").each((_, td) => {
  const d = clean($(td).text()), f = $(td).find("img").attr("alt");
  if (d) luna.push({ dia: +d, fase: f || null });
});

// Ciudades cercanas / principales
const ciudades = [];
$("a[title^='Clima en']").each((_, a) => {
  const t = clean($(a).text()), r = t.match(/^(.*?)\s+(-?\d+)°\s+(-?\d+)°$/);
  if (r) ciudades.push({ ciudad: r[1], max: +r[2], min: +r[3], condicion: $(a).find("img").attr("alt") || null, url: $(a).attr("href") });
});

const data = { fuente: URL, actualizado: new Date().toISOString(), ubicacion: "Veracruz, México", actual: current, dias, horas, sol, aire, climaMes, resumen, luna, ciudades };
fs.writeFileSync("data.json", JSON.stringify(data, null, 2));
fs.writeFileSync("data.js", "window.CLIMA=" + JSON.stringify(data) + ";");
console.log(`OK: ${dias.length} días, ${horas.length} horas, ${ciudades.length} ciudades`);
if (!dias.length || !horas.length) console.warn("⚠ Parseo parcial: revisa selectores/regex");
