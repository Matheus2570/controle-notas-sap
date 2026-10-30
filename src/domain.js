export const STATUSES = ['rascunho','solicitado','nota_recebida','concluido','cancelado'];
export const STATUS_NAMES = {rascunho:'A pedir',solicitado:'Pedido',nota_recebida:'Nota recebida',concluido:'Concluído',cancelado:'Cancelado'};
export const PROCESSES = ['3d','cnc','outro','indefinido'];
export const PROCESS_NAMES = {'3d':'Impressão 3D',cnc:'CNC',outro:'Outro',indefinido:'Não definido'};
export const today = () => new Date().toLocaleDateString('en-CA');
export const id = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const money = value => Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export const dateLabel = value => value ? String(value).slice(0,10).split('-').reverse().join('/') : '—';
export const itemTotal = item => Number(item.quantity||0)*Number(item.unit_price||0);
export const normalizeKey = v => String(v||'').trim().toLocaleLowerCase('pt-BR');
export const matches = (m,filters, sites=[]) => {
  const q=normalizeKey(filters.search); const site=sites.find(s=>s.id===m.site_id);
  if(q && ![m.sap_code,m.forms_code,m.description,m.notes,site?.name].some(v=>normalizeKey(v).includes(q))) return false;
  if(filters.status && m.status!==filters.status) return false;
  if(filters.process && m.process!==filters.process) return false;
  if(filters.site_id && m.site_id!==filters.site_id) return false;
  if(filters.from && m.requested_on<filters.from) return false;
  if(filters.to && m.requested_on>filters.to) return false;
  if(filters.min_value!==''&&filters.min_value!=null&&itemTotal(m)<Number(filters.min_value))return false;
  if(filters.max_value!==''&&filters.max_value!=null&&itemTotal(m)>Number(filters.max_value))return false;
  if(filters.invoice==='with' && !m.invoice_id) return false;
  if(filters.invoice==='without' && m.invoice_id) return false;
  return true;
};
export const sortMaterials = (rows,sort='recent') => [...rows].sort((a,b)=>{
  const cmp=(x,y)=>String(x??'').localeCompare(String(y??''),'pt-BR',{numeric:true,sensitivity:'base'});
  switch(sort){
    case 'oldest':return cmp(a.created_at,b.created_at);
    case 'date_asc':return cmp(a.requested_on,b.requested_on)||cmp(a.id,b.id);
    case 'date_desc':return cmp(b.requested_on,a.requested_on)||cmp(b.created_at,a.created_at);
    case 'sap':return cmp(a.sap_code,b.sap_code)||cmp(a.created_at,b.created_at);
    case 'forms':return cmp(a.forms_code,b.forms_code)||cmp(a.created_at,b.created_at);
    case 'description':return cmp(a.description,b.description);
    case 'value_asc':return itemTotal(a)-itemTotal(b);
    case 'value_desc':return itemTotal(b)-itemTotal(a);
    case 'status':return cmp(a.status,b.status);
    case 'quantity_desc':return Number(b.quantity||0)-Number(a.quantity||0);
    case 'quantity_asc':return Number(a.quantity||0)-Number(b.quantity||0);
    case 'unit_desc':return Number(b.unit_price||0)-Number(a.unit_price||0);
    case 'unit_asc':return Number(a.unit_price||0)-Number(b.unit_price||0);
    case 'site':return cmp(a.site_name,b.site_name);
    case 'process':return cmp(PROCESS_NAMES[a.process],PROCESS_NAMES[b.process]);
    default:return cmp(b.created_at,a.created_at)||cmp(b.id,a.id);
  }
});
export const validateInvoiceSelection = (ids,materials,currentInvoiceId=null) => {
  const unique=[...new Set(ids)];
  if(!unique.length||unique.length>4) throw new Error('Selecione de 1 a 4 materiais por nota fiscal.');
  unique.forEach(k=>{const m=materials.find(v=>v.id===k);if(!m)throw new Error('Material não encontrado.');if(m.status!=='solicitado'&&!(currentInvoiceId&&m.invoice_id===currentInvoiceId))throw new Error('Solicite o material no SAP (status Pedido) antes de vincular a nota fiscal.');if(m.invoice_id&&m.invoice_id!==currentInvoiceId)throw new Error('Este material já está vinculado a outra nota.');});
  return unique;
};
export const parseExcel = input => String(input||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map((line,i)=>{
  const [sap_code='',forms_code='',description='',process='indefinido',quantity='1',unit_price='0']=line.split('\t');
  if(!sap_code.trim()&&!forms_code.trim())throw new Error(`Linha ${i+1}: preencha SAP ou Forms.`);
  const qty=Number(String(quantity).replace(',','.'));const price=Number(String(unit_price).includes(',') ? String(unit_price).replace(/\./g,'').replace(',','.') : String(unit_price));
  if(!(qty>0)||!(price>=0))throw new Error(`Linha ${i+1}: quantidade ou preço inválido.`);
  return {sap_code:sap_code.trim(),forms_code:forms_code.trim(),description:description.trim(),process:PROCESSES.includes(process.trim().toLowerCase())?process.trim().toLowerCase():'indefinido',quantity:qty,unit_price:price};
});
export const toCsv = rows => {
  const esc=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const cols=['Data','Site','SAP','Forms','Descrição','Processo','Quantidade','Valor unitário','Total','Status','Bloco','Nota fiscal'];
  const lines=rows.map(r=>[r.requested_on,r.site_name||'',r.sap_code,r.forms_code,r.description,PROCESS_NAMES[r.process],r.quantity,r.unit_price,itemTotal(r),STATUS_NAMES[r.status],r.block_name||'',r.invoice_number||''].map(esc).join(';'));
  return '\uFEFF'+[cols.map(esc).join(';'),...lines].join('\r\n');
};
export const transitionOnLink = (material) => ({...material, prior_status:material.status,status:'nota_recebida'});
export const transitionOnUnlink = (material) => ({...material,status:material.prior_status||'solicitado',prior_status:null,invoice_id:null});
