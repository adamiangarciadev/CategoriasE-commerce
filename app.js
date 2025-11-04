// app.js — Gestor de Categorías y Asignación de Artículos

const EL = id => document.getElementById(id);

const normalizeHeader = (s='') => s
  .toString()
  .normalize('NFD').replace(/\p{Diacritic}/gu,'')
  .replace(/\s+/g,' ')
  .trim().toLowerCase();

function csvCell(v){
  if(v===undefined || v===null) return '';
  const s = String(v).replaceAll('"','""');
  return /[",\n]/.test(s) ? '"'+s+'"' : s;
}

function renderTable(el, rows, limit=100){
  if(!rows?.length){ el.innerHTML = '<div class="small">(sin filas)</div>'; return; }
  const keys = Object.keys(rows[0]);
  const head = '<tr>'+keys.map(k=>`<th>${k}</th>`).join('')+'</tr>';
  const body = rows.slice(0,limit).map(r=>'<tr>'+keys.map(k=>`<td>${String(r[k]).replaceAll('<','&lt;')}</td>`).join('')+'</tr>').join('');
  el.innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>` + (rows.length>limit?`<div class="small">Mostrando ${limit} de ${rows.length} filas…</div>`:'');
}

// Reemplaza tu readFile por esta:
function readFile(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const isCSV  = /\.csv$/i.test(file.name);
    const isXLS  = /\.xls$/i.test(file.name);      // BIFF (viejo)
    const isXLSX = /\.xlsx$/i.test(file.name);

    reader.onload = (e) => {
      try {
        let wb;
        if (isCSV) {
          // Texto plano
          const text = e.target.result;
          wb = XLSX.read(text, { type: 'string' });
        } else {
          // ArrayBuffer para .xls/.xlsx
          const data = new Uint8Array(e.target.result);
          wb = XLSX.read(data, { type: 'array' });
        }
        const ws = wb.Sheets[wb.SheetNames[0]];
        // Usamos una extracción robusta que detecta la fila de encabezado
        const rows = extractRows(ws);
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };

    if (isCSV) reader.readAsText(file);
    else reader.readAsArrayBuffer(file); // <- .XLS y .XLSX van por acá
  });
}

// Helper: detecta la fila de encabezados y devuelve objetos [{col:valor,...}]
function extractRows(worksheet){
  // 1) Leemos como matriz (AOA)
  const aoa = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: '' });

  if (!aoa || !aoa.length) return [];

  // 2) Normalizador de encabezados
  const norm = s => String(s||'')
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .replace(/\s+/g,' ')
    .trim().toLowerCase();

  // 3) Lista de posibles headers que esperamos ver en cada archivo
  const wantedAny = [
    // Categorías
    'codigo','código','code','id',
    'categoria','categoría','name','nombre',
    'es subcategoria de','es subcategoría de','padre','parent','parent_id',
    'rama','ruta','path',
    'codcat1','cat1','nivel1',
    'codcat2','cat2','nivel2',
    'codcat3','cat3','nivel3',
    'codcat4','cat4','nivel4',
    // Artículos
    'descripcion','descripción','detalle','nombre','desc',
    'genero','género','sexo','rubro','target','a','b','l'
  ];

  // 4) Buscamos la fila que más “parece” encabezado
  let headerRowIdx = 0;
  let bestScore = -1;
  for (let i=0; i<Math.min(25, aoa.length); i++){
    const row = aoa[i];
    const score = (row||[]).reduce((acc, cell) => acc + (wantedAny.includes(norm(cell)) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; headerRowIdx = i; }
  }

  const headersRaw = (aoa[headerRowIdx] || []).map(x => String(x||''));
  // Si la cabecera está vacía, devolvemos vacío
  if (!headersRaw.length) return [];

  // 5) Armamos objetos desde la fila siguiente a la cabecera
  const body = aoa.slice(headerRowIdx + 1);

  // 6) Forzamos a string ciertos campos típicos (para no perder ceros a la izquierda)
  const forceStringCols = new Set([
    'codigo','código','code','id',
    'codcat1','codcat2','codcat3','codcat4'
  ]);

  const rows = body.map(r => {
    const obj = {};
    headersRaw.forEach((h, idx) => {
      const v = (r && idx < r.length) ? r[idx] : '';
      const headerNorm = norm(h);
      // si la columna es de códigos, fuerzo string
      if (forceStringCols.has(headerNorm)) {
        obj[h] = (v === null || v === undefined) ? '' : String(v);
      } else {
        obj[h] = v;
      }
    });
    return obj;
  });

  return rows;
}



// ====== CATEGORÍAS ======
let categoriaRows = [];
let rutaToCodes = {};

const headerAliases = {
  'codigo':['codigo','código','code','id'],
  'categoria':['categoria','categoría','name','nombre'],
  'es_subcategoria_de':['es subcategoria de','es subcategoría de','padre','parent'],
  'rama':['rama','ruta','path'],
  'codcat1':['codcat1','cat1','nivel1'],
  'codcat2':['codcat2','cat2','nivel2'],
  'codcat3':['codcat3','cat3','nivel3'],
  'codcat4':['codcat4','cat4','nivel4']
};

function mapHeaders(row){
  const mapped = {};
  for(const [std, aliases] of Object.entries(headerAliases)){
    let foundKey = Object.keys(row).find(k=> aliases.includes(normalizeHeader(k)));
    if(foundKey) mapped[std] = row[foundKey];
  }
  return mapped;
}

EL('fileCategorias').addEventListener('change', async (ev)=>{
  const f = ev.target.files?.[0];
  if(!f) return;
  EL('summaryCategorias').textContent = 'Leyendo…';
  try{
    const rows = await readFile(f);
    renderTable(EL('previewCategorias'), rows, 60);
    categoriaRows = rows.map(mapHeaders).map(r=>({
      codigo: String(r.codigo||'').trim(),
      categoria: String(r.categoria||'').trim(),
      rama: String(r.rama||'').trim(),
      codcat1: r.codcat1||'',
      codcat2: r.codcat2||'',
      codcat3: r.codcat3||'',
      codcat4: r.codcat4||''
    }));
    categoriaRows.forEach(r=>{
      const ruta = r.rama;
      if(!ruta) return;
      rutaToCodes[ruta] = [
        String(r.codcat1||'').trim(),
        String(r.codcat2||'').trim(),
        String(r.codcat3||'').trim(),
        String(r.codcat4||'').trim()
      ];
    });
    EL('summaryCategorias').innerHTML = `Archivo: <b>${f.name}</b> · Filas: <b>${rows.length}</b>`;
  }catch(err){
    EL('summaryCategorias').innerHTML = `<span class="err">Error: ${err.message}</span>`;
  }
});

// ====== ARTÍCULOS ======
let articulos = [];
let ramasPorGenero = { Mujer:[], Hombre:[], Niños:[] };

const headerAliasesArt = {
  codigo:['codigo','código','cod','id','articulo','artículo','a'],
  descripcion:['descripcion','descripción','detalle','nombre','desc'],
  genero:['genero','género','sexo','l','rubro','target']
};

function mapHeadersArt(row){
  const out={};
  for(const [std,aliases] of Object.entries(headerAliasesArt)){
    const key = Object.keys(row).find(k=> aliases.includes(normalizeHeader(k)));
    if(key) out[std]=row[key];
  }
  return out;
}

function normalizeGenero(g){
  const s = String(g||'').toLowerCase().normalize('NFD').replace(/\\p{Diacritic}/gu,'').trim();
  if(/mujer|fem/.test(s)) return 'Mujer';
  if(/hombre|masc|caballero/.test(s)) return 'Hombre';
  if(/nene|nena|nino|nina|niño|niña|kids|infantil/.test(s)) return 'Niños';
  return 'Niños';
}

function normalizeArticulo(r){
  return {
    codigo: String(r.codigo||'').trim(),
    descripcion: String(r.descripcion||'').trim(),
    genero: normalizeGenero(r.genero),
    ramaSeleccionada: ''
  };
}

function buildRamasPorGenero(){
  ramasPorGenero = { Mujer:[], Hombre:[], Niños:[] };
  const setMap = { Mujer:new Set(), Hombre:new Set(), Niños:new Set() };
  (categoriaRows||[]).forEach(r=>{
    const ruta = r.rama;
    if(!ruta) return;
    if(/mujer/i.test(ruta)) setMap.Mujer.add(ruta);
    if(/hombre/i.test(ruta)) setMap.Hombre.add(ruta);
    if(/niñ|nene|nina|kids/i.test(ruta)) setMap.Niños.add(ruta);
  });
  Object.keys(setMap).forEach(k=> ramasPorGenero[k] = Array.from(setMap[k]).sort());
}

function optionListForGenero(g){
  if(!ramasPorGenero.Mujer.length && !ramasPorGenero.Hombre.length && !ramasPorGenero.Niños.length)
    buildRamasPorGenero();
  const list = ramasPorGenero[g]||[];
  return ['', '— Seleccionar Rama —', ...list];
}

function renderTablaArticulos(filter=''){
  const tableEl = EL('tablaArticulos');
  if(!articulos.length){ tableEl.innerHTML = '<div class="small">(subí el archivo de artículos)</div>'; return; }
  const rows = articulos.filter(a=> !filter || (a.codigo+' '+a.descripcion).toLowerCase().includes(filter.toLowerCase()));
  const head = '<tr><th>Código</th><th>Descripción</th><th>Género</th><th>Rama</th></tr>';
  const body = rows.map(a=>{
    const opts = optionListForGenero(a.genero).map((v,i)=>`<option value=\"${v}\" ${a.ramaSeleccionada===v?'selected':''}>${i===0?'':v}</option>`).join('');
    return `<tr><td>${a.codigo}</td><td>${a.descripcion}</td><td><span class=\"pill\">${a.genero}</span></td>
    <td><select data-code=\"${a.codigo}\" class=\"selRama\">${opts}</select></td></tr>`;
  }).join('');
  tableEl.innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  document.querySelectorAll('.selRama').forEach(sel=> sel.addEventListener('change', e=>{
    const code = e.target.getAttribute('data-code');
    const it = articulos.find(x=> x.codigo===code);
    if(it) it.ramaSeleccionada = e.target.value;
  }));
}

EL('fileSecundario').addEventListener('change', async (ev)=>{
  const f = ev.target.files?.[0];
  if(!f) return;
  EL('summarySecundario').textContent = 'Leyendo…';
  try{
    const rows = await readFile(f);
    renderTable(EL('previewSecundario'), rows, 60);
    articulos = rows.map(mapHeadersArt).map(normalizeArticulo);
    buildRamasPorGenero();
    renderTablaArticulos();
    EL('summarySecundario').innerHTML = `Archivo: <b>${f.name}</b> · Filas: <b>${rows.length}</b>`;
  }catch(err){
    EL('summarySecundario').innerHTML = `<span class="err">Error: ${err.message}</span>`;
  }
});

EL('buscarArt').addEventListener('input', e=> renderTablaArticulos(e.target.value||''));

EL('btnExportArt').addEventListener('click', ()=>{
  const cols = ['codigo','descripcion','genero','rama'];
  const lines = [cols.join(',')].concat(
    articulos.filter(a=> a.ramaSeleccionada).map(a=> cols.map(c=> csvCell(a[c])).join(','))
  );
  const blob = new Blob([lines.join('\\n')], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='articulos_ramas.csv'; a.click();
});

EL('btnExportArtSemi').addEventListener('click', ()=>{
  const selected = articulos.filter(a=> a.ramaSeleccionada);
  const outLines = [];
  selected.forEach(a=>{
    const ruta = a.ramaSeleccionada;
    const [c1,c2,c3,c4] = (rutaToCodes[ruta]) || ['','','',''];
    [c1,c2,c3,c4].filter(x=> x).forEach(codeCat=>{
      outLines.push([a.codigo, a.codigo, codeCat].join(';'));
    });
  });
  const blob = new Blob([outLines.join('\\n')], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='asignacion_categorias_por_nivel.csv'; a.click();
});
