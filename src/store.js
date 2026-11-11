import {createClient} from '@supabase/supabase-js';
import {id,today,transitionOnLink,transitionOnUnlink,validateInvoiceSelection,canGroupMaterial,nextBlockName,blockNumber} from './domain.js';

const url=import.meta.env?.VITE_SUPABASE_URL?.trim();
const key=import.meta.env?.VITE_SUPABASE_ANON_KEY?.trim();
export const cloud=Boolean(url && key && !url.includes('SEU-PROJETO'));
export const supabase=cloud?createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true}}):null;
const KEY='notaflow-v2-demo-v1';
const empty=()=>({sites:[],blocks:[],materials:[],invoices:[],invoice_materials:[],activity:[]});
const now=()=>new Date().toISOString();
let memory=null;
const read=()=>{if(memory)return memory;try{const data=JSON.parse(localStorage.getItem(KEY));memory={...empty(),...data};}catch{memory=empty();}return memory;};
const write=()=>localStorage.setItem(KEY,JSON.stringify(memory));
const log=(entity,entity_id,action,summary)=>{const db=read();db.activity.unshift({id:id(),entity,entity_id,action,summary:String(summary||'').slice(0,240),author_id:null,happened_at:now()});};
const materialRef=r=>['sap_code','forms_code'].map(k=>r?.[k]?`${k==='sap_code'?'SAP':'Forms'} ${r[k]}`:'').filter(Boolean).join(' · ')||'Material';
const changeDetails=(before,after)=>{
  const fields={status:'status',quantity:'qtd',unit_price:'unitário',process:'processo',block_id:'bloco',site_id:'site',sap_code:'SAP',forms_code:'Forms',description:'descrição',requested_on:'data',notes:'observações'};
  return Object.entries(fields).filter(([k])=>String(before?.[k]??'')!==String(after?.[k]??'')).map(([k,label])=>
    ['status','quantity','unit_price','process'].includes(k)?`${label} ${before?.[k]??'—'} → ${after?.[k]??'—'}`:`${label} alterado(a)`
  ).join('; ');
};
const names={sites:'nf_sites',blocks:'nf_blocks',materials:'nf_materials',invoices:'nf_invoices',invoice_materials:'nf_invoice_materials',activity:'nf_activity'};
const fail=error=>{if(error)throw new Error(error.message||String(error));};
export async function fetchAll(table,client=supabase){
  // A tabela de vínculos tem PK composta; não possui coluna id.
  const orderColumns=table==='invoice_materials'?['invoice_id','material_id']:['id'];
  const all=[];for(let page=0;;page++){
    let query=client.from(names[table]).select('*');
    for(const column of orderColumns)query=query.order(column,{ascending:true});
    const {data,error}=await query.range(page*750,(page+1)*750-1);
    fail(error);all.push(...(data||[]));if((data||[]).length<750)return all;
  }
}
async function fetchRecentActivity(){
  const {data,error}=await supabase.from('nf_activity').select('*').order('happened_at',{ascending:false}).limit(150);
  fail(error);return data||[];
}
export async function loadAll(){
  if(!cloud){const data=structuredClone(read());data.activity=data.activity.slice(0,150);return data;}
  const tables=Object.keys(names);
  // Evita carregar o histórico inteiro a cada atualização. Os registros continuam no banco.
  const responses=await Promise.all(tables.map(t=>t==='activity'?fetchRecentActivity():fetchAll(t)));
  return Object.fromEntries(tables.map((t,i)=>[t,responses[i]]));
}
export async function getDatabaseUsageBytes(){
  if(!cloud)return null;
  const {data,error}=await supabase.rpc('nf_database_usage_bytes');
  fail(error);
  const bytes=Number(data);
  if(!Number.isFinite(bytes)||bytes<0)throw new Error('Tamanho do banco inválido.');
  return bytes;
}
export async function getRole(userId){
  if(!cloud)return 'admin';
  const {data,error}=await supabase.from('nf_profiles').select('role').eq('user_id',userId).maybeSingle();fail(error);return data?.role||'viewer';
}
export async function saveRow(table,payload){
  const row={...payload};
  if(!cloud){const db=read();if(table==='materials'&&row.status==='nota_recebida'&&!db.invoice_materials.some(l=>l.material_id===row.id))throw new Error('Nota recebida só pode ser definida pelo vínculo com uma NF.');const list=db[table];const original=list.find(x=>x.id===row.id);
    if(table==='blocks'&&row.name!==undefined&&(!original||original.name!==row.name)){
      const number=blockNumber(row.name);if(number!==null&&db.blocks.some(b=>b.id!==row.id&&blockNumber(b.name)===number))throw new Error('Já existe um bloco ativo com este número. Escolha outro nome.');
    }
    if(table==='materials'){
      if(row.block_id&&(!original||row.block_id!==original.block_id))validateDemoDestination(db,original?[original.id]:[],row.block_id,original?0:1);
      if(original&&db.invoice_materials.some(l=>l.material_id===row.id)&&row.status&&!['nota_recebida','concluido'].includes(row.status))throw new Error('Material possui nota fiscal. Desvincule a nota primeiro.');
    }
    if(table==='materials'&&original&&db.invoice_materials.some(l=>l.material_id===row.id)&&['sap_code','forms_code','description','quantity','unit_price','site_id','requested_on'].some(k=>row[k]!==undefined&&String(row[k])!==String(original[k])))throw new Error('Desvincule a nota fiscal antes de alterar os dados fiscais do material.');
    if(original){const before={...original};Object.assign(original,row,{updated_at:now()});log(table,row.id,table==='materials'&&before.status!==row.status?'status':'update',table==='materials'?`${materialRef(row)} · ${changeDetails(before,original)}`:row.name||row.number||'');}
    const saved=original||{id:id(),created_at:now(),...row};
    if(!original){list.unshift(saved);log(table,saved.id,'insert',table==='materials'?materialRef(saved):saved.name||saved.number||'');}
    if(table==='materials'&&!original&&row.auto_group_on_insert!==false)groupUnassignedDemo([saved.id]);
    write();return structuredClone(saved);
  }
  const {data,error}=await supabase.from(names[table]).upsert(row).select('*').single();fail(error);return data;
}
export async function deleteRow(table,rowId){
  if(table==='invoices')return deleteInvoice(rowId);
  if(table==='blocks')return closeBlock(rowId);
  if(!cloud){const db=read();if(table==='sites'&&db.materials.some(x=>x.site_id===rowId))throw new Error('Site possui materiais vinculados.');if(table==='materials'&&db.invoice_materials.some(x=>x.material_id===rowId))throw new Error('Remova a nota fiscal antes de excluir o material.');
    const deleted=db[table].find(x=>x.id===rowId);db[table]=db[table].filter(x=>x.id!==rowId);log(table,rowId,'delete',table==='materials'?materialRef(deleted):deleted?.name||deleted?.number||'');write();return;
  }
  const {error}=await supabase.from(names[table]).delete().eq('id',rowId);fail(error);
}
export async function setMaterialStatus(materialIds,status){
  if(!materialIds.length)return;
  if(!cloud){const db=read();const chosen=db.materials.filter(m=>materialIds.includes(m.id));for(const m of chosen){const linked=db.invoice_materials.some(l=>l.material_id===m.id);if(linked&&!['nota_recebida','concluido'].includes(status))throw new Error('Material possui nota fiscal. Desvincule a nota primeiro.');if(status==='nota_recebida'&&!linked)throw new Error('Somente vincular uma nota fiscal pode definir Nota recebida.');}
    for(const m of chosen){m.status=status;m.updated_at=now();log('materials',m.id,'status',`${materialRef(m)} · status alterado para ${status}`);}
    write();return;}
  const {error}=await supabase.from('nf_materials').update({status}).in('id',materialIds);fail(error);
}
// IDs explícitos no cadastro; a varredura completa existe só na ação manual.
function groupUnassignedDemo(materialIds){
  const db=read(); let count=0;
  const linkedIds=new Set(db.invoice_materials.map(link=>link.material_id));
  const pending=db.materials.filter(m=>(!materialIds||materialIds.includes(m.id))&&canGroupMaterial(m)&&!linkedIds.has(m.id)).sort((a,b)=>
    String(a.site_id||'').localeCompare(String(b.site_id||''))||
    (['cnc','3d','outro','indefinido'].indexOf(a.process)-['cnc','3d','outro','indefinido'].indexOf(b.process))||
    String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.id).localeCompare(String(b.id)));
  for(const material of pending){
    const site=material.site_id||null,process=material.process||'indefinido';
    let block=db.blocks.filter(b=>{
      const members=db.materials.filter(x=>x.block_id===b.id);
      return b.auto_created&&(b.site_id||null)===site&&b.process===process&&members.length<4&&members.every(x=>x.status===material.status&&x.process===process&&(x.site_id||null)===site&&!x.invoice_id&&!linkedIds.has(x.id));
    })
      .sort((a,b)=>a.position-b.position)[0];
    if(!block){
      const position=Math.max(-1,...db.blocks.map(b=>Number(b.position)||0))+1;
      block={id:id(),name:nextBlockName(db.blocks),position,process,site_id:site,auto_created:true,created_at:now()};
      db.blocks.push(block);log('blocks',block.id,'insert',block.name);
    }
    material.block_id=block.id;
    material.position=Math.max(-1,...db.materials.filter(x=>x.block_id===block.id&&x.id!==material.id).map(x=>Number(x.position)||0))+1;
    material.updated_at=now();log('materials',material.id,'update',`${materialRef(material)} · bloco alterado`);
    count++;
  }
  return count;
}
export async function autoGroupMaterials(){
  if(!cloud){const count=groupUnassignedDemo();write();return count;}
  const {data,error}=await supabase.rpc('nf_autogroup_materials');
  fail(error);return data;
}
function validateDemoDestination(db,materialIds,blockId,additional=0){
  if(!db.blocks.some(b=>b.id===blockId))throw new Error('Bloco de destino não encontrado.');
  const total=db.materials.filter(m=>m.block_id===blockId&&!materialIds.includes(m.id)).length+materialIds.length+additional;
  if(total>4)throw new Error('O bloco aceita no máximo 4 materiais.');
}
export async function closeBlock(blockId){
  if(!cloud){
    const db=read();const block=db.blocks.find(b=>b.id===blockId);
    if(!block)throw new Error('Bloco não encontrado. Atualize os dados.');
    for(const material of db.materials.filter(m=>m.block_id===blockId)){
      material.block_id=null;material.updated_at=now();log('materials',material.id,'update',`${materialRef(material)} · bloco encerrado`);
    }
    db.blocks=db.blocks.filter(b=>b.id!==blockId);log('blocks',blockId,'delete',block.name);write();return;
  }
  const {error}=await supabase.rpc('nf_close_block',{p_block_id:blockId});fail(error);
}
export async function reorderBlocks(blockIds){
  if(!cloud){
    const db=read();if(new Set(blockIds).size!==db.blocks.length||blockIds.length!==db.blocks.length||blockIds.some(k=>!db.blocks.some(b=>b.id===k)))throw new Error('A lista de blocos mudou. Atualize os dados.');
    blockIds.forEach((blockId,position)=>{const block=db.blocks.find(b=>b.id===blockId);if(block.position!==position){block.position=position;log('blocks',blockId,'update',`${block.name} · ordem alterada`);}});write();return;
  }
  const {error}=await supabase.rpc('nf_reorder_blocks',{p_block_ids:blockIds});fail(error);
}
export async function moveMaterials(materialIds,blockId){
  if(!materialIds.length)return;
  if(!cloud){const db=read();const unique=[...new Set(materialIds)];if(unique.some(k=>!db.materials.some(m=>m.id===k)))throw new Error('Material não encontrado.');if(blockId)validateDemoDestination(db,unique,blockId);
    for(const m of db.materials.filter(m=>unique.includes(m.id)&&(m.block_id||null)!==(blockId||null))){m.block_id=blockId||null;m.position=blockId?Math.max(-1,...db.materials.filter(x=>x.block_id===blockId&&x.id!==m.id).map(x=>Number(x.position)||0))+1:0;m.updated_at=now();log('materials',m.id,'update',`${materialRef(m)} · bloco alterado`);}write();return;}
  const {error}=await supabase.rpc('nf_move_materials',{p_material_ids:materialIds,p_block_id:blockId||null});fail(error);
}
export async function saveManyMaterials(items){
  if(!items.length)return;
  if(!cloud){const before=structuredClone(read());try{for(const item of items)await saveRow('materials',item);}catch(error){memory=before;write();throw error;}return;}
  const {error}=await supabase.from('nf_materials').insert(items);fail(error);
}
export async function saveInvoice(invoice,materialIds){
  if(!cloud){const db=read();const existing=invoice.id?db.invoices.find(x=>x.id===invoice.id):null;if(invoice.id&&!existing)throw new Error('Nota fiscal não encontrada.');if(!String(invoice.number||'').trim())throw new Error('Informe o número da nota.');if(invoice.access_key&&!/^\d{44}$/.test(invoice.access_key))throw new Error('Chave NF-e inválida: digite 44 números.');
    const unique=validateInvoiceSelection(materialIds,db.materials,existing?.id||null);
    const last=db.invoice_materials.filter(l=>l.invoice_id===existing?.id);
    for(const link of last.filter(l=>!unique.includes(l.material_id))){const m=db.materials.find(x=>x.id===link.material_id);Object.assign(m,transitionOnUnlink({...m,prior_status:link.prior_status}));}
    db.invoice_materials=db.invoice_materials.filter(l=>l.invoice_id!==existing?.id||unique.includes(l.material_id));
    const row={...invoice,id:existing?.id||id(),created_at:existing?.created_at||now(),updated_at:now()};
    if(existing)Object.assign(existing,row);else db.invoices.unshift(row);
    for(const mid of unique){if(db.invoice_materials.some(l=>l.invoice_id===row.id&&l.material_id===mid))continue;
      const m=db.materials.find(x=>x.id===mid);const old=m.status;Object.assign(m,transitionOnLink(m),{invoice_id:row.id});
      db.invoice_materials.push({invoice_id:row.id,material_id:mid,prior_status:old,added_at:now()});
    }
    log('invoices',row.id,existing?'update':'insert',row.number);write();return row.id;
  }
  const {data,error}=await supabase.rpc('nf_save_invoice',{p_id:invoice.id||null,p_number:invoice.number,p_access_key:invoice.access_key||'',p_issued_on:invoice.issued_on||today(),p_notes:invoice.notes||'',p_material_ids:materialIds});
  fail(error);return data;
}
export async function deleteInvoice(invoiceId){
  if(!cloud){const db=read();const links=db.invoice_materials.filter(l=>l.invoice_id===invoiceId);
    for(const link of links){const m=db.materials.find(x=>x.id===link.material_id);if(m)Object.assign(m,transitionOnUnlink({...m,prior_status:link.prior_status}));}
    db.invoice_materials=db.invoice_materials.filter(l=>l.invoice_id!==invoiceId);db.invoices=db.invoices.filter(i=>i.id!==invoiceId);log('invoices',invoiceId,'delete','');write();return;
  }
  const {error}=await supabase.from('nf_invoices').delete().eq('id',invoiceId);fail(error);
}
export function mergeView(raw){
  const siteMap=new Map(raw.sites.map(s=>[s.id,s]));const blockMap=new Map(raw.blocks.map(b=>[b.id,b]));const invoiceMap=new Map(raw.invoices.map(i=>[i.id,i]));
  const linkMap=new Map(raw.invoice_materials.map(l=>[l.material_id,l]));
  const materials=raw.materials.map(m=>{const link=linkMap.get(m.id),invoice=link&&invoiceMap.get(link.invoice_id);
    return {...m,invoice_id:link?.invoice_id||null,invoice_number:invoice?.number||'',invoice_issued_on:invoice?.issued_on||'',site_name:siteMap.get(m.site_id)?.name||'',block_name:blockMap.get(m.block_id)?.name||''};
  });
  const invs=raw.invoices.map(i=>({...i,material_ids:raw.invoice_materials.filter(l=>l.invoice_id===i.id).map(l=>l.material_id)}));
  return {...raw,materials,invoices:invs};
}
