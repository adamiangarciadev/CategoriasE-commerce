// app.js — Gestor de Categorías E‑commerce
// Requiere: index.html + styles.css y la librería SheetJS (xlsx.full.min.js)

// ===== Utilidades base =====
const EL = id => document.getElementById(id);

const normalizeHeader = (s='') => s
  .toString()
  .normalize('NFD').replace(/\p{Diacritic}/gu,'') // quita tildes
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

function readFile(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      try{
        // Si es CSV, leer como texto; si es Excel, como arraybuffer
        const isCSV = /\.csv$/i.test(file.name);
        if(isCSV){
          // Parse rápido CSV usando SheetJS (detecta separadores comunes)
          const wb = XLSX.read(e.target.result, {type:'string'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(ws, {defval:'', raw:true});
          resolve(json);
        } else {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, {type:'array'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(ws, {defval:'', raw:true});
          resolve(json);
        }
      }catch(err){ reject(err); }
    };
    if(/\.csv$/i.test(file.name)) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

// ====== Mapeo de encabezados (Categorías) ======
const headerAliases = {
  'codigo':['codigo','código','code','id'],
  'categoria':['categoria','categoría','name','nombre'],
  'es_subcategoria_de':['es subcategoria de','es subcategoría de','padre','parent','parent_id','es_subcategoria_de'],
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

// ====== Estado global ======
let categoriaRowsRaw = [];
let categoriaRows = []; // mapeadas a encabezados estándar
let flatOutput = [];
// Mapa: ruta completa -> [codcat1,codcat2,codcat3,codcat4]
let rutaToCodes = {};

// ====== Lectura de CATEGORÍAS ======
EL('fileCategorias').addEventListener('change', async (ev)=>{
  const f = ev.target.files?.[0];
  if(!f) return;
  EL('summaryCategorias').textContent = 'Leyendo…';
  try{
    categoriaRowsRaw = await readFile(f);
    renderTable(EL('previewCategorias'), categoriaRowsRaw, 60);
    categoriaRows = categoriaRowsRaw.map(mapHeaders).map(r=>({
      codigo: (r.codigo!==undefined && r.codigo!==null && r.codigo!=='')? String(r.codigo).trim() : '',
      categoria: (r.categoria??'').toString().trim(),
      es_subcategoria_de: (r.es_subcategoria_de!==undefined && r.es_subcategoria_de!==null && r.es_subcategoria_de!=='') ? String(r.es_subcategoria_de).trim() : '',
      rama: (r.rama??'').toString().trim(),
      codcat1: r.codcat1??'',
      codcat2: r.codcat2??'',
      codcat3: r.codcat3??'',
      codcat4: r.codcat4??''
    }));
    EL('summaryCategorias').innerHTML = `Archivo: <b>${f.name}</b> · Filas: <b>${categoriaRowsRaw.length}</b>`;
    processTree();
  }catch(err){
    console.error(err);
    EL('summaryCategorias').innerHTML = `<span class="err">Error leyendo el archivo: ${err.message}</span>`;
  }
});

// ====== Construcción de árbol, validaciones y salida plana ======
function processTree(){
  if(!categoriaRows.length){
    EL('tree').innerHTML = '<div class="small">Subí el archivo de categorías para ver el árbol…</div>';
    EL('tablaSalida').innerHTML = '';
    EL('btnExportCSV').disabled = true; EL('btnExportJSON').disabled = true;
    EL('valResumen').textContent = 'Validaciones: —';
    return;
  }

  // Index por código
  const byCode = new Map();
  const errors = [];
  const warns = [];

  for(const r of categoriaRows){
    if(!r.codigo || !r.categoria){ errors.push(`Fila con campos obligatorios vacíos (codigo/nombre).`); }
    if(byCode.has(r.codigo)) errors.push(`Código duplicado: ${r.codigo}`);
    byCode.set(r.codigo, {...r, children:[]});
  }

  // Enlazar padres
  const roots = [];
  for(const node of byCode.values()){
    const parentCode = (node.es_subcategoria_de||'').toString().trim();
    if(!parentCode || parentCode==='0' || parentCode==='-'){
      roots.push(node);
    }else{
      const parent = byCode.get(parentCode);
      if(parent) parent.children.push(node); else warns.push(`Padre no encontrado para código ${node.codigo} → ${parentCode}`);
    }
  }

  // Ordenar por nombre dentro de cada nivel (estable)
  const sortByName = n => n.children.sort((a,b)=> String(a.categoria).localeCompare(String(b.categoria))).forEach(sortByName);
  roots.sort((a,b)=> String(a.categoria).localeCompare(String(b.categoria))).forEach(sortByName);

  // Generar salida plana y pintar árbol
  flatOutput = [];
  const acc = [];
  // Reiniciar mapping ruta -> codes al recalcular
  rutaToCodes = {};
  const walk = (node, lvl=0, trail=[])=>{
    const ruta = [...trail, node.categoria].join(' > ');
    flatOutput.push({
      codigo: node.codigo,
      nombre: node.categoria,
      padre: (node.es_subcategoria_de||'')||'',
      nivel: lvl,
      ruta,
      codcat1: node.codcat1||'', codcat2: node.codcat2||'', codcat3: node.codcat3||'', codcat4: node.codcat4||''
    });
    // guardar mapping ruta -> códigos por nivel (si vienen en columnas codcat1..4)
    const codes = [
      String(node.codcat1||'').trim(),
      String(node.codcat2||'').trim(),
      String(node.codcat3||'').trim(),
      String(node.codcat4||'').trim()
    ];
    rutaToCodes[ruta] = codes;
    acc.push(renderNode(node, lvl, ruta));
    node.children.forEach(ch=>walk(ch, lvl+1, [...trail, node.categoria]));
  };
  roots.forEach(r=>walk(r,0,[]));

  EL('tree').innerHTML = acc.join('') || '<div class="small">(sin nodos)</div>';

  // Tabla de salida
  renderTable(EL('tablaSalida'), flatOutput, 200);

  // Validaciones
  const res = [];
  if(errors.length) res.push(`<span class="err">${errors.length} errores</span>`);
  if(warns.length) res.push(`<span class="warn">${warns.length} advertencias</span>`);
  if(!errors.length && !warns.length) res.push('<span class="ok">OK sin observaciones</span>');
  EL('valResumen').innerHTML = 'Validaciones: ' + res.join(' · ');

  // Habilitar exportación
  EL('btnExportCSV').disabled = flatOutput.length===0;
  EL('btnExportJSON').disabled = flatOutput.length===0;
}

function renderNode(node, lvl, ruta){
  const tags = [];
  ['codcat1','codcat2','codcat3','codcat4'].forEach(k=>{
    if(node[k]!=='' && node[k]!==undefined) tags.push(`<span class="pill">${k.replace('cod','').toUpperCase()}: ${node[k]}</span>`);
  });
  return `
    <div class="node lvl-${lvl}">
      <div class="row">
        <strong>${node.categoria}</strong>
        <span class="small">(#${node.codigo}${node.es_subcategoria_de?` · padre ${node.es_subcategoria_de}`:''})</span>
        <span class="meta">nivel ${lvl}</span>
        <div class="tags">${tags.join('')}</div>
      </div>
      <div class="small" style="padding-left: calc(var(--indent) + 8px); opacity:.8">${ruta}</div>
    </div>`;
}

// ===== Búsqueda en árbol =====
EL('txtBuscar').addEventListener('input', (e)=>{
  const q = e.target.value.trim().toLowerCase();
  if(!q){ processTree(); return; }
  if(!flatOutput.length){ return; }
  const filteredCodes = new Set();
  flatOutput.forEach(r=>{
    const hit = [r.codigo, r.nombre, r.ruta].some(x=> String(x).toLowerCase().includes(q));
    if(hit) filteredCodes.add(r.codigo);
  });
  // Volver a pintar árbol mostrando solo hits (simplificado)
  const byCode = new Map(categoriaRows.map(r=>[r.codigo,{...r,children:[]}]));
  categoriaRows.forEach(r=>{ if(r.es_subcategoria_de && byCode.has(r.es_subcategoria_de)) byCode.get(r.es_subcategoria_de).children.push(byCode.get(r.codigo)); });
  const roots = [...byCode.values()].filter(n=>!n.es_subcategoria_de || n.es_subcategoria_de==='0');
  const acc = [];
  const walk=(node,lvl=0,trail=[])=>{
    const ruta=[...trail,node.categoria].join(' > ');
    if(filteredCodes.has(node.codigo)) acc.push(renderNode(node,lvl,ruta));
    node.children.forEach(ch=>walk(ch,lvl+1,[...trail,node.categoria]));
  };
  roots.forEach(r=>walk(r,0,[]));
  EL('tree').innerHTML = acc.join('') || '<div class="small">(sin coincidencias)</div>';
});

// ===== Exportaciones de categorías =====
EL('btnExportJSON').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(flatOutput, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'categorias_flat.json';
  a.click();
});
EL('btnExportCSV').addEventListener('click', ()=>{
  if(!flatOutput.length) return;
  const cols = ['codigo','nombre','padre','nivel','ruta','codcat1','codcat2','codcat3','codcat4'];
  const lines = [cols.join(',')].concat(flatOutput.map(r=> cols.map(c=> csvCell(r[c])).join(',')));
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'categorias_flat.csv';
  a.click();
});

// =====================================================================
// ================== Asignar RAMA a ARTÍCULOS ==========================
// =====================================================================

let articulos = [];
let ramasPorGenero = { Mujer:[], Hombre:[], Niños:[] };

const headerAliasesArt = {
  codigo:['codigo','código','cod','id','articulo','artículo','a'],
  descripcion:['descripcion','descripción','detalle','nombre','desc','b','descripcion del articulo'],
  genero:['genero','género','sexo','l','rubro','target']
};
const normalizeHeaderArt = s => (s||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim().toLowerCase();
function mapHeadersArt(row){
  const out={};
  for(const [std,aliases] of Object.entries(headerAliasesArt)){
    const key = Object.keys(row).find(k=> aliases.includes(normalizeHeaderArt(k)));
    if(key) out[std]=row[key];
  }
  return out;
}
function normalizeGenero(g){
  const s = String(g||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').trim();
  if(/mujer|fem/.test(s)) return 'Mujer';
  if(/hombre|masc|caballero/.test(s)) return 'Hombre';
  if(/nene|nena|nino|nina|niño|niña|kids|infantil|menor|chico|chica/.test(s)) return 'Niños';
  return 'Niños';
}
function normalizeArticulo(r){
  return {
    codigo: (r.codigo!==undefined && r.codigo!==null)? String(r.codigo).trim() : '',
    descripcion: (r.descripcion??'').toString().trim(),
    genero: normalizeGenero(r.genero),
    ramaSeleccionada: ''
  };
}

function buildRamasPorGenero(){
  ramasPorGenero = { Mujer:[], Hombre:[], Niños:[] };
  const setMap = { Mujer:new Set(), Hombre:new Set(), Niños:new Set() };
  (categoriaRows||[]).forEach(r=>{
    const ruta = (r.rama||'').toString();
    if(!ruta) return;
    const root = ruta.split('>')[0]?.trim();
    let key = root;
    if(/niñ|nene|nena|nino|nina|niño|niña/i.test(root)) key='Niños';
    if(/mujer/i.test(root)) key='Mujer';
    if(/hombre/i.test(root)) key='Hombre';
    if(['Mujer','Hombre','Niños'].includes(key)) setMap[key].add(ruta);
  });
  Object.keys(setMap).forEach(k=> ramasPorGenero[k] = Array.from(setMap[k]).sort());
}

function optionListForGenero(g){
  if(!ramasPorGenero.Mujer.length && !ramasPorGenero.Hombre.length && !ramasPorGenero.Niños.length) buildRamasPorGenero();
  const list = ramasPorGenero[g]||[];
  return ['', '— Seleccionar Rama —', ...list];
}

function renderTablaArticulos(filter=''){
  const tableEl = EL('tablaArticulos');
  if(!articulos.length){ tableEl.innerHTML = '<div class="small">(subí el archivo de artículos)</div>'; EL('btnExportArt').disabled=true; EL('btnExportArtSemi').disabled=true; return; }
  const rows = articulos.filter(a=> !filter || (a.codigo+' '+a.descripcion).toLowerCase().includes(filter.toLowerCase()));
  if(!rows.length){ tableEl.innerHTML='<div class="small">(sin coincidencias)</div>'; EL('btnExportArt').disabled=true; EL('btnExportArtSemi').disabled=true; return; }
  const head = '<tr><th style="width:120px">Código</th><th>Descripción</th><th style="width:160px">Género</th><th>Rama</th></tr>';
  const body = rows.map(a=>{
    const opts = optionListForGenero(a.genero).map((v,i)=>`<option value="${String(v).replaceAll('"','&quot;')}" ${a.ramaSeleccionada===v?'selected':''}>${i===0?'':v}</option>`).join('');
    return `<tr>
      <td>${a.codigo}</td>
      <td>${a.descripcion}</td>
      <td><span class="pill">${a.genero}</span></td>
      <td>
        <select data-code="${a.codigo}" class="selRama" style="width:100%;background:#10141d;border:1px solid #273042;color:#dbe3ef;padding:8px;border-radius:10px">
          ${opts}
        </select>
      </td>
    </tr>`;
  }).join('');
  tableEl.innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  document.querySelectorAll('.selRama').forEach(sel=> sel.addEventListener('change', e=>{
    const code = e.target.getAttribute('data-code');
    const it = articulos.find(x=> x.codigo===code);
    if(it) it.ramaSeleccionada = e.target.value;
    const anySel = articulos.some(x=> x.ramaSeleccionada);
    EL('btnExportArt').disabled = !anySel;
    EL('btnExportArtSemi').disabled = !anySel;
  }));
}

// Preview del segundo archivo y armado de tabla de asignación
EL('fileSecundario').addEventListener('change', async (ev)=>{
  const f = ev.target.files?.[0];
  if(!f) return;
  EL('summarySecundario').textContent = 'Leyendo…';
  try{
    const rows = await readFile(f);
    renderTable(EL('previewSecundario'), rows, 60);
    EL('summarySecundario').innerHTML = `Archivo: <b>${f.name}</b> · Filas: <b>${rows.length}</b>`;
    articulos = rows.map(mapHeadersArt).map(normalizeArticulo);
    buildRamasPorGenero();
    renderTablaArticulos();
  }catch(err){
    EL('summarySecundario').innerHTML = `<span class="err">Error leyendo el archivo: ${err.message}</span>`;
  }
});

// Buscar artículos
EL('buscarArt').addEventListener('input', (e)=>{
  renderTablaArticulos(e.target.value||'');
});

// Exportar mapeo (coma)
EL('btnExportArt').addEventListener('click', ()=>{
  const cols = ['codigo','descripcion','genero','rama'];
  const lines = [cols.join(',')].concat(
    articulos.filter(a=> a.ramaSeleccionada).map(a=> cols.map(c=> csvCell(c==='rama'? a.ramaSeleccionada : (c==='descripcion'? a.descripcion : a[c]))).join(','))
  );
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='articulos_ramas.csv'; a.click();
});

// ✅ Exportar asignación por nivel con ";"
// Formato requerido (una línea por nivel de la rama):
// ART001;ART001;1\n
// ART001;ART001;120 ...
EL('btnExportArtSemi').addEventListener('click', ()=>{
  const selected = articulos.filter(a=> a.ramaSeleccionada);
  if(!selected.length){ return; }
  const outLines = [];
  selected.forEach(a=>{
    const ruta = a.ramaSeleccionada;
    const [c1,c2,c3,c4] = (rutaToCodes && rutaToCodes[ruta]) || ['','','',''];
    [c1,c2,c3,c4].filter(x=> x && String(x).trim()!=='').forEach(codeCat=>{
      outLines.push([a.codigo, a.codigo, codeCat].join(';'));
    });
  });
  const blob = new Blob([outLines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='asignacion_categorias_por_nivel.csv'; a.click();
});
