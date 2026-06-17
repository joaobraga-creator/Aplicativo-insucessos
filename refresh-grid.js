import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const DOC_ID = process.env.GRID_DOC_ID || '01KV8XY6PJHV85S4MJVQ6JF18W';
const PROJECT_ID = process.env.BQ_PROJECT_ID || 'meli-bi-data';
const LOCATION = process.env.BQ_LOCATION || 'US';
const MAX_ROWS = process.env.BQ_MAX_ROWS || '100000';

function runBq(query) {
  return new Promise((resolve, reject) => {
    const args = [
      `--project_id=${PROJECT_ID}`,
      'query',
      `--location=${LOCATION}`,
      '--use_legacy_sql=false',
      '--format=json',
      `--max_rows=${MAX_ROWS}`
    ];
    const child = spawn('bq', args, { shell: true });
    const out = [];
    const err = [];
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (code !== 0) {
        reject(new Error(stderr || stdout || `bq exited with ${code}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(query);
  });
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function jsonForHtml(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function dedupeShipments(rows) {
  const byShipment = new Map();
  for (const row of rows) {
    const shipmentId = String(row.shipment_id ?? row.SHP_SHIPMENT_ID ?? '').trim();
    if (!shipmentId) continue;
    const current = byShipment.get(shipmentId);
    if (!current) {
      byShipment.set(shipmentId, row);
      continue;
    }
    const rowDate = String(row.data_base ?? '');
    const currentDate = String(current.data_base ?? '');
    const rowPriority = row.local_pacote === 'COM_MOTORISTA' ? 1 : 0;
    const currentPriority = current.local_pacote === 'COM_MOTORISTA' ? 1 : 0;
    if (rowDate > currentDate || (rowDate === currentDate && rowPriority > currentPriority)) {
      byShipment.set(shipmentId, row);
    }
  }
  return [...byShipment.values()];
}

function buildHtml(rows) {
  const updatedAt = rows[0]?.updated_at || new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const fields = [
    'data_base', 'aging_dias', 'shipment_id', 'local_pacote', 'subregional', 'svc', 'facility_node',
    'route_id', 'driver_id', 'transportadora', 'vehicle_plate', 'vehicle_type', 'final_status', 'acao'
  ];
  const slimRows = rows.map(row => Object.fromEntries(fields.concat(['updated_at', 'valor_usd']).map(key => [key, row[key] ?? ''])));
  const compressedRows = gzipSync(Buffer.from(JSON.stringify(slimRows), 'utf8'), { level: 9 }).toString('base64');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inconformidades PU NEX MLB</title>
<style>
:root{--yellow:#ffe000;--navy:#111426;--blue:#3483fa;--bg:#f3f5f8;--line:#d9e0ea;--text:#071b3a;--muted:#657083;--green:#00a650;--orange:#ff8a00;--red:#d81b45}
*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;background:var(--bg);color:var(--text)}button,select,input{font:inherit}
.top{height:86px;background:var(--yellow);display:flex;align-items:center;justify-content:space-between;padding:0 28px;border-bottom:1px solid #d8bd00}
.brand{display:flex;align-items:center;gap:14px}.logo{width:56px;height:42px;border:3px solid #1d2d79;border-radius:50%;background:#fff;display:grid;place-items:center;font-weight:900;color:#1d2d79}.title h1{margin:0;font-size:28px;letter-spacing:0}.title p{margin:4px 0 0;font-size:13px;font-weight:700}.stamp{font-weight:800}
.nav{height:44px;background:var(--navy);display:flex;align-items:center;padding:0 24px;gap:8px}.nav button{height:44px;border:0;background:transparent;color:#dce4ff;font-weight:800;padding:0 14px;cursor:pointer;border-bottom:3px solid transparent}.nav button.active{color:#fff;border-color:var(--yellow)}
.wrap{padding:18px 24px 28px}.filters{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px;display:flex;flex-wrap:wrap;gap:14px;align-items:end;box-shadow:0 2px 9px #001a3a14}.field{display:flex;gap:8px;align-items:center}.field label{font-size:13px;font-weight:900;color:var(--muted)}select,input{height:38px;border:1px solid var(--line);border-radius:7px;background:#fff;padding:0 12px;min-width:150px}input{min-width:260px}.clear{height:38px;border:1px solid var(--blue);background:#fff;color:var(--blue);font-weight:800;border-radius:7px;padding:0 14px;cursor:pointer}
.cards{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:12px;margin:18px 0}.card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:16px;border-top:4px solid var(--blue);box-shadow:0 2px 8px #001a3a12}.card.green{border-top-color:var(--green)}.card.orange{border-top-color:var(--orange)}.card.red{border-top-color:var(--red)}.num{font-size:28px;font-weight:900}.lbl{color:var(--muted);font-size:13px;margin-top:5px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.panel{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden;box-shadow:0 2px 8px #001a3a10}.panel h2{margin:0;padding:14px 16px;border-bottom:1px solid var(--line);font-size:20px}.rows{padding:12px 16px;max-height:390px;overflow:auto}.bar{display:grid;grid-template-columns:150px 1fr 80px;gap:10px;align-items:center;margin:8px 0;font-size:13px}.track{height:14px;background:#e9eef5;border-radius:99px;overflow:hidden}.fill{height:100%;background:var(--blue);border-radius:99px}.bar.orange .fill{background:var(--orange)}
.table{width:100%;border-collapse:collapse;font-size:12px}.table th{position:sticky;top:0;background:#f7f9fc;color:#536176;text-align:left;border-bottom:1px solid var(--line);padding:10px}.table td{border-bottom:1px solid #edf1f5;padding:9px 10px;vertical-align:top}.pill{display:inline-block;border-radius:99px;padding:4px 8px;font-weight:900;font-size:11px}.nodo{background:#e8f6ee;color:#007a3d}.mot{background:#fff1df;color:#b45b00}
.hide{display:none}.note{margin:12px 0;background:#eef5ff;border-left:4px solid var(--blue);padding:10px 12px;font-size:14px}.right{text-align:right}@media(max-width:980px){.cards,.grid2{grid-template-columns:1fr}.top{height:auto;gap:12px;align-items:flex-start;flex-direction:column;padding:18px}.stamp{text-align:left}.bar{grid-template-columns:110px 1fr 58px}input{min-width:100%}.field{width:100%;align-items:flex-start;flex-direction:column}select{width:100%}}
</style>
</head>
<body>
<header class="top"><div class="brand"><div class="logo">ML</div><div class="title"><h1>Inconformidades PU NEX MLB</h1><p>Pacotes NEX nao entregues: visao por nodos/places, motoristas e pacotes</p></div></div><div class="stamp">Atualizado em ${esc(updatedAt)}</div></header>
<nav class="nav"><button data-tab="resumo" class="active">Resumo</button><button data-tab="nodos">Nodos/places</button><button data-tab="motoristas">Motoristas</button><button data-tab="pacotes">Pacotes</button></nav>
<main class="wrap">
  <section class="filters">
    <div class="field"><label>SUB-REGIONAL</label><select id="fSub"><option value="">Todos</option></select></div>
    <div class="field"><label>SVC</label><select id="fSvc"><option value="">Todos</option></select></div>
    <div class="field"><label>TIPO</label><select id="fTipo"><option value="">Todos</option><option>NO_NODO</option><option>COM_MOTORISTA</option></select></div>
    <div class="field"><label>DATA DE</label><input id="fDe" type="date"></div>
    <div class="field"><label>DATA ATE</label><input id="fAte" type="date"></div>
    <div class="field"><label>BUSCA</label><input id="fBusca" placeholder="Pacote, facility, rota, placa, transportadora"></div>
    <button id="clear" class="clear">Limpar filtros</button>
  </section>
  <section class="note"><b>Leitura operacional:</b> NO_NODO = pacote parado no nodo/place aguardando devolucao NEX. COM_MOTORISTA = rota/transportadora/placa visivel para devolucao place > SVC. A base atual nao traz nome do motorista; mostra rota, placa e transportadora.</section>
  <section id="view"></section>
</main>
<script>
const DATA_B64='${compressedRows}';
const FIELDS=${jsonForHtml(fields)};
let DATA=[];
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const fmt=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'USD'}).format(Number(n||0));
let tab='resumo';

async function loadData(){
  if(!('DecompressionStream' in window)) throw new Error('Chrome sem suporte a DecompressionStream');
  const binary=atob(DATA_B64);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  const stream=new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
  DATA=JSON.parse(await new Response(stream).text());
}

function uniq(key){return [...new Set(DATA.map(r=>r[key]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'))}
function fillSelect(id,key){const el=$(id); uniq(key).forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;el.appendChild(o)})}
function filtered(){
  const sub=$('fSub').value, svc=$('fSvc').value, tipo=$('fTipo').value, de=$('fDe').value, ate=$('fAte').value, q=$('fBusca').value.trim().toLowerCase();
  return DATA.filter(r=>{
    if(sub && r.subregional!==sub) return false;
    if(svc && r.svc!==svc) return false;
    if(tipo && r.local_pacote!==tipo) return false;
    if(de && String(r.data_base||'')<de) return false;
    if(ate && String(r.data_base||'')>ate) return false;
    if(q && !FIELDS.some(k=>String(r[k]??'').toLowerCase().includes(q))) return false;
    return true;
  });
}
function group(rows,key){const m=new Map(); rows.forEach(r=>m.set(r[key]||'SEM_INFO',(m.get(r[key]||'SEM_INFO')||0)+1)); return [...m.entries()].sort((a,b)=>b[1]-a[1])}
function topBars(title, rows, key, color=''){
  const g=group(rows,key).slice(0,18); const max=Math.max(1,...g.map(x=>x[1]));
  return '<div class="panel"><h2>'+title+'</h2><div class="rows">'+g.map(([k,v])=>'<div class="bar '+color+'"><b>'+esc(k)+'</b><div class="track"><div class="fill" style="width:'+(v/max*100)+'%"></div></div><b class="right">'+fmt(v)+'</b></div>').join('')+'</div></div>';
}
function table(rows, limit=500){
  const cols=[['data_base','Data'],['aging_dias','Aging'],['shipment_id','Pacote'],['local_pacote','Local'],['subregional','Subregional'],['svc','SVC'],['facility_node','Nodo/place'],['route_id','Rota'],['transportadora','Transportadora'],['vehicle_plate','Placa'],['acao','Acao']];
  return '<div class="panel"><h2>Pacotes detalhados <span style="float:right;font-size:12px;color:#657083">'+fmt(Math.min(rows.length,limit))+' de '+fmt(rows.length)+'</span></h2><div style="overflow:auto;max-height:520px"><table class="table"><thead><tr>'+cols.map(c=>'<th>'+c[1]+'</th>').join('')+'</tr></thead><tbody>'+rows.slice(0,limit).map(r=>'<tr>'+cols.map(([k])=>'<td>'+(k==='local_pacote'?'<span class="pill '+(r[k]==='COM_MOTORISTA'?'mot':'nodo')+'">'+esc(r[k])+'</span>':esc(r[k]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></div>';
}
function render(){
  const rows=filtered();
  const nodos=rows.filter(r=>r.local_pacote==='NO_NODO');
  const mot=rows.filter(r=>r.local_pacote==='COM_MOTORISTA');
  const maxAging=Math.max(0,...rows.map(r=>Number(r.aging_dias||0)));
  const val=rows.reduce((s,r)=>s+Number(r.valor_usd||0),0);
  const cards='<section class="cards"><div class="card"><div class="num">'+fmt(rows.length)+'</div><div class="lbl">pacotes filtrados</div></div><div class="card green"><div class="num">'+fmt(nodos.length)+'</div><div class="lbl">nos nodos/places</div></div><div class="card orange"><div class="num">'+fmt(mot.length)+'</div><div class="lbl">com motorista/rota</div></div><div class="card red"><div class="num">'+fmt(maxAging)+'</div><div class="lbl">maior aging</div></div><div class="card"><div class="num">'+money(val)+'</div><div class="lbl">valor USD</div></div></section>';
  if(tab==='resumo') $('view').innerHTML=cards+'<section class="grid2">'+topBars('Subregional',rows,'subregional')+topBars('SVC',rows,'svc')+topBars('Nodos/places',nodos,'facility_node')+topBars('Transportadoras',mot,'transportadora','orange')+'</section>';
  if(tab==='nodos') $('view').innerHTML=cards+'<section class="grid2">'+topBars('Facilities com pacotes parados',nodos,'facility_node')+topBars('SVC responsavel',nodos,'svc')+'</section><br>'+table(nodos,700);
  if(tab==='motoristas') $('view').innerHTML=cards+'<section class="grid2">'+topBars('Transportadora',mot,'transportadora','orange')+topBars('Placa',mot,'vehicle_plate','orange')+'</section><br>'+table(mot,700);
  if(tab==='pacotes') $('view').innerHTML=cards+table(rows,1000);
}
document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');tab=b.dataset.tab;render()});
['fSub','fSvc','fTipo','fDe','fAte','fBusca'].forEach(id=>$(id).addEventListener('input',render));
$('clear').onclick=()=>{['fSub','fSvc','fTipo','fDe','fAte','fBusca'].forEach(id=>$(id).value='');render()};
loadData().then(()=>{fillSelect('fSub','subregional'); fillSelect('fSvc','svc'); render()}).catch(err=>{$('view').innerHTML='<section class="note"><b>Erro ao abrir dados comprimidos:</b> '+esc(err.message)+'</section>'});
</script>
</body></html>`;
}

async function uploadGrid(html) {
  const start = await fetch('https://grid.melioffice.com/api/v1/documents/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'index.html', existing_doc_id: DOC_ID, content_type: 'text/html' })
  });
  if (!start.ok) throw new Error(`Grid upload-url failed: ${start.status} ${await start.text()}`);
  const meta = await start.json();
  const bytes = Buffer.from(html, 'utf8');
  const put = await fetch(meta.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/html', 'Content-Length': String(bytes.length) },
    body: bytes
  });
  if (!put.ok) throw new Error(`Grid PUT failed: ${put.status} ${await put.text()}`);
  const confirm = await fetch(`https://grid.melioffice.com/api/v1/documents/${meta.doc_id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_size: bytes.length, idempotency_key: `nex-refresh-${Date.now()}` })
  });
  if (!confirm.ok) throw new Error(`Grid confirm failed: ${confirm.status} ${await confirm.text()}`);
  return await confirm.json();
}

const query = await fs.readFile('query_insucessos_nex_mlb.sql', 'utf8');
console.log('Rodando BigQuery...');
const stdout = await runBq(query);
const rawRows = JSON.parse(stdout || '[]');
const rows = dedupeShipments(rawRows);
console.log(`Linhas retornadas: ${rawRows.length}`);
console.log(`Pacotes unicos publicados: ${rows.length}`);
const html = buildHtml(rows);
await fs.writeFile('grid-preview.html', html, 'utf8');
console.log('Publicando no Grid...');
const result = await uploadGrid(html);
console.log(`Grid atualizado: https://grid.adminml.com/d/${result.doc_id || DOC_ID}/view`);
