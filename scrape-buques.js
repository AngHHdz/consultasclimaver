import fs from "node:fs";

const PAGE="https://www.mediport.com.mx/tableroOperativo/TablerosPublicos/atracados.aspx";
const API="https://www.mediport.com.mx/tableroOperativo/Tableros/buquesAtracados.aspx/consultaBuquesAtracados";
const OUTPUT="buques-autos.json";
const previous=()=>{try{return JSON.parse(fs.readFileSync(OUTPUT,"utf8"));}catch{return null;}};

async function main(){
  const response=await fetch(API,{
    method:"POST",
    headers:{
      "User-Agent":"Mozilla/5.0 (compatible; CLIMAPUERTO/1.0)",
      "Content-Type":"application/json; charset=utf-8",
      "Accept":"application/json, text/javascript, */*; q=0.01",
      "X-Requested-With":"XMLHttpRequest",
      "Origin":"https://www.mediport.com.mx",
      "Referer":PAGE
    },
    body:JSON.stringify({pNidApi:1}),
    signal:AbortSignal.timeout(30000)
  });
  if(!response.ok)throw new Error("MEDI-PORT HTTP "+response.status);
  const payload=await response.json();
  const records=payload?.d?.datos;
  if(Number(payload?.d?.estado)!==1||!Array.isArray(records)||records.length===0)
    throw new Error("Respuesta de MEDI-PORT sin registros válidos.");
  const buques=records.filter(row=>String(row.carga)==="21"||/autom[oó]viles/i.test(String(row.descripcion_carga||"")))
    .map(row=>({
      viaje:String(row.viaje||""),
      buque:String(row.buque||"").replace(/\s*\( Reg\.\s*\d+\s*\)/i,"").trim(),
      muelle:String(row.muelle||""),
      agencia:String(row.naviera||""),
      fecha:String(row.atraque||""),
      maniobrista:String(row.maniobrista||"").trim(),
      descripcionCarga:String(row.descripcion_carga||"AUTOMOVILES"),
      eta:String(row.eta||""),
      etf:String(row.etf||""),
      eslora:String(row.eslora||""),
      calado:String(row.calado||""),
      imo:String(row.imo||""),
      nidBuque:String(row.nidbuque||"")
    })).filter(row=>row.viaje&&row.buque);
  const data={
    fuente:PAGE,endpoint:API,consultado:new Date().toISOString(),
    actualizado:new Date().toISOString(),disponible:true,total:buques.length,
    totalBuquesAtracados:records.length,buques
  };
  fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2)+"\n");
  console.log("OK MEDI-PORT: "+records.length+" buques atracados; "+buques.length+" automotrices: "+buques.map(x=>x.buque+" ("+x.viaje+")").join(", "));
}
try{await main();}
catch(error){
  console.error("ERROR scraper de buques:",error.message);
  const old=previous();
  if(old)fs.writeFileSync(OUTPUT,JSON.stringify({...old,consultado:new Date().toISOString(),disponible:false,error:error.message},null,2)+"\n");
  process.exitCode=1;
}