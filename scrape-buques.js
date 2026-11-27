import fs from "node:fs";

const PAGE = "https://www.mediport.com.mx/tableroOperativo/TablerosPublicos/atracados.aspx";
const API = "https://www.mediport.com.mx/tableroOperativo/Tableros/buquesAtracados.aspx/consultaBuquesAtracados";
const OUTPUT = "buques-autos.json";
const previous = () => { try { return JSON.parse(fs.readFileSync(OUTPUT, "utf8")); } catch { return null; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Carga automotriz: código 21 o una descripción que lo indique (antes solo se aceptaba "AUTOMOVILES").
const CAR_CODE = "21";
const CAR_TEXT = /autom[oó]vil|veh[ií]cul|\bautos?\b|camioneta|ro-?ro/i;
export const isAutomotive = row => String(row.carga) === CAR_CODE || CAR_TEXT.test(String(row.descripcion_carga || ""));

async function fetchRecords() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; CLIMAPUERTO/1.0)",
          "Content-Type": "application/json; charset=utf-8",
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
          "Origin": "https://www.mediport.com.mx",
          "Referer": PAGE
        },
        body: JSON.stringify({ pNidApi: 1 }),
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error("MEDI-PORT HTTP " + response.status);
      const payload = await response.json();
      const records = payload?.d?.datos;
      if (Number(payload?.d?.estado) !== 1 || !Array.isArray(records))
        throw new Error(payload?.d?.mensaje || "Respuesta de MEDI-PORT sin registros válidos.");
      return records;
    } catch (error) {
      lastError = error;
      console.warn(`Intento ${attempt}/3 falló: ${error.message}`);
      if (attempt < 3) await sleep(attempt * 4000);
    }
  }
  throw lastError;
}

async function main() {
  const records = await fetchRecords();
  const clean = row => String(row ?? "").trim();
  const buques = records.filter(isAutomotive).map(row => ({
    viaje: clean(row.viaje),
    buque: clean(row.buque).replace(/\s*\( Reg\.\s*\d+\s*\)/i, ""),
    muelle: clean(row.muelle),
    agencia: clean(row.naviera),
    fecha: clean(row.atraque),
    maniobrista: clean(row.maniobrista),
    descripcionCarga: clean(row.descripcion_carga) || "AUTOMOVILES",
    eta: clean(row.eta), etf: clean(row.etf),
    eslora: clean(row.eslora), calado: clean(row.calado),
    imo: clean(row.imo), nidBuque: clean(row.nidbuque)
  })).filter(row => row.viaje && row.buque);

  // Diagnóstico: qué otras cargas hay atracadas (para detectar buques automotrices que el filtro no reconozca).
  const cargas = {};
  for (const r of records) { const k = clean(r.descripcion_carga) || "(sin descripción)"; cargas[k] = (cargas[k] || 0) + 1; }
  const otros = records.filter(r => !isAutomotive(r)).map(r => ({
    buque: clean(r.buque).replace(/\s*\( Reg\.\s*\d+\s*\)/i, ""), muelle: clean(r.muelle),
    carga: clean(r.carga), descripcionCarga: clean(r.descripcion_carga), fecha: clean(r.atraque)
  }));

  const now = new Date().toISOString();
  const data = {
    fuente: PAGE, endpoint: API, consultado: now, actualizado: now, disponible: true,
    total: buques.length, totalBuquesAtracados: records.length, buques, cargas, otros
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2) + "\n");
  console.log(`OK MEDI-PORT: ${records.length} atracados; ${buques.length} automotrices: ${buques.map(x => `${x.buque} (${x.viaje})`).join(", ") || "ninguno"}`);
  console.log("Cargas atracadas:", JSON.stringify(cargas));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try { await main(); }
  catch (error) {
    console.error("ERROR scraper de buques:", error.message);
    const old = previous();
    if (old) fs.writeFileSync(OUTPUT, JSON.stringify({ ...old, consultado: new Date().toISOString(), disponible: false, error: error.message }, null, 2) + "\n");
    process.exitCode = 1;
  }
}
