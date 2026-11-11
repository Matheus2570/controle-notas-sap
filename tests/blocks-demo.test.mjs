import test from 'node:test';
import assert from 'node:assert/strict';
import {nextBlockName,blockStage,isReceivedMaterial} from '../src/domain.js';

let scenario=0;
async function demo(){
  const values=new Map();
  globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const store=await import(`../src/store.js?scenario=${scenario++}`);
  const site=await store.saveRow('sites',{name:'Site de teste'});
  let sequence=0;
  const create=(process='cnc',extra={})=>store.saveRow('materials',{
    sap_code:`SAP-${++sequence}`,forms_code:`F-${sequence}`,description:`Peça ${sequence}`,process,
    site_id:site.id,status:'rascunho',quantity:1,unit_price:25,requested_on:'2026-11-11',notes:'Preservar',...extra
  });
  return {...store,create,site,values};
}

test('demo: 4 CNC e 1 3D criam dois blocos separados, com até quatro',async()=>{
  const s=await demo();for(let i=0;i<4;i++)await s.create();await s.create('3d');
  const db=await s.loadAll();assert.equal(db.blocks.length,2);
  assert.deepEqual(db.blocks.map(b=>db.materials.filter(m=>m.block_id===b.id).length),[4,1]);
  assert.deepEqual(db.blocks.map(b=>b.name),['BLOCO 001','BLOCO 002']);
});
test('demo: excluir bloco e cadastrar não reagrupa materiais antigos',async()=>{
  const s=await demo();const first=await s.create();const second=await s.create();
  await s.deleteRow('blocks',first.block_id);const fresh=await s.create();
  const db=await s.loadAll();assert.equal(db.materials.length,3);
  assert.equal(db.materials.find(m=>m.id===first.id).block_id,null);
  assert.equal(db.materials.find(m=>m.id===second.id).block_id,null);
  assert.notEqual(fresh.block_id,first.block_id);
  assert.equal(db.blocks[0].name,'BLOCO 001');
});
test('demo: remoção manual e escolha inicial Sem bloco persistem até ação manual',async()=>{
  const s=await demo();const first=await s.create();await s.moveMaterials([first.id],null);
  const separate=await s.create('3d',{auto_group_on_insert:false});await s.create();
  let db=await s.loadAll();assert.equal(db.materials.find(m=>m.id===first.id).block_id,null);
  assert.ok(!db.materials.find(m=>m.id===separate.id).block_id);
  assert.equal(await s.autoGroupMaterials(),2);
  db=await s.loadAll();assert.ok(db.materials.every(m=>m.block_id));
});
test('demo: registrar NF e encerrar bloco preserva materiais, nota, links e demais status',async()=>{
  const s=await demo();const a=await s.create(),b=await s.create(),other=await s.create('3d');
  await s.setMaterialStatus([a.id,b.id],'solicitado');
  const invoiceId=await s.saveInvoice({number:'12345',access_key:'1'.repeat(44),issued_on:'2026-11-11'},[a.id,b.id]);
  const before=await s.loadAll();await s.closeBlock(a.block_id);await s.create();await s.autoGroupMaterials();
  const after=await s.loadAll();assert.deepEqual(after.invoices,before.invoices);assert.deepEqual(after.invoice_materials,before.invoice_materials);
  for(const old of before.materials){const current=after.materials.find(m=>m.id===old.id);for(const field of ['id','sap_code','forms_code','description','process','status','quantity','unit_price','notes','site_id','invoice_id'])assert.equal(current[field],old[field]);}
  const view=s.mergeView(after);for(const mid of [a.id,b.id]){const material=view.materials.find(m=>m.id===mid);assert.equal(material.block_id,null);assert.equal(material.invoice_id,invoiceId);assert.equal(material.invoice_number,'12345');assert.equal(material.invoice_issued_on,'2026-11-11');}
  assert.equal(after.materials.find(m=>m.id===other.id).status,'rascunho');assert.ok(after.activity.length>=before.activity.length);
});
test('demo: automático e manual ignoram concluídos, cancelados e materiais com NF',async()=>{
  const s=await demo();const done=await s.create('cnc',{status:'concluido'}),cancelled=await s.create('3d',{status:'cancelado'});
  await s.create();assert.equal(await s.autoGroupMaterials(),0);
  const db=await s.loadAll();for(const item of [done,cancelled])assert.ok(!db.materials.find(m=>m.id===item.id).block_id);
});
test('demo: nome Misto — Pt2 é preservado, aceita processos distintos e rejeita quinto item',async()=>{
  const s=await demo();const cnc=await s.create(),threeD=await s.create('3d');
  await s.saveRow('blocks',{id:cnc.block_id,name:'Misto — Pt2',auto_created:false});await s.moveMaterials([threeD.id],cnc.block_id);
  const extra1=await s.create('outro'),extra2=await s.create('3d');await s.moveMaterials([extra1.id,extra2.id],cnc.block_id);
  const fifth=await s.create('cnc');await assert.rejects(()=>s.moveMaterials([fifth.id],cnc.block_id),/4 materiais/);
  await assert.rejects(()=>s.create('3d',{block_id:cnc.block_id}),/4 materiais/);
  const db=await s.loadAll();assert.equal(db.blocks.find(b=>b.id===cnc.block_id).name,'Misto — Pt2');assert.equal(db.materials.filter(m=>m.block_id===cnc.block_id).length,4);
});
test('demo: recarga restaura nomes e ordem; novas numerações usam lacunas',async()=>{
  const s=await demo();const a=await s.create(),b=await s.create('3d');
  await s.saveRow('blocks',{id:a.block_id,name:'CNC — Urgente',auto_created:false});
  await s.reorderBlocks([b.block_id,a.block_id]);const before=await s.loadAll();
  const reloaded=await import(`../src/store.js?scenario=${scenario++}`);assert.deepEqual(await reloaded.loadAll(),before);
  assert.equal(nextBlockName([{name:'BLOCO 001 — CNC'},{name:'BLOCO 003'}]),'BLOCO 002');
  for(const block of before.blocks)await reloaded.closeBlock(block.id);
  assert.equal(nextBlockName((await reloaded.loadAll()).blocks),'BLOCO 001');
});
test('demo: nomes automáticos não duplicam e material com ID explícito ocupa só uma vaga',async()=>{
  const s=await demo();const a=await s.create();await s.create();await s.create();
  await s.create('3d',{id:crypto.randomUUID(),block_id:a.block_id});
  assert.equal((await s.loadAll()).materials.filter(m=>m.block_id===a.block_id).length,4);
  await assert.rejects(()=>s.saveRow('blocks',{name:'BLOCO 001 — CNC'}),/Já existe/);
});
test('demo: importar em bloco cheio é transacional',async()=>{
  const s=await demo();const material=await s.create();const before=await s.loadAll();
  await assert.rejects(()=>s.saveManyMaterials(Array.from({length:4},(_,index)=>({sap_code:`I-${index}`,process:'3d',status:'rascunho',block_id:material.block_id}))),/4 materiais/);
  assert.deepEqual(await s.loadAll(),before);
});
test('demo: encerrar bloco mantém também as atividades antigas fora da janela de leitura',async()=>{
  const values=new Map();const history=Array.from({length:1001},(_,i)=>({id:`antigo-${i}`,entity:'materials',action:'update',happened_at:'2026-11-01T00:00:00Z'}));
  values.set('notaflow-v2-demo-v1',JSON.stringify({blocks:[{id:'old-block',name:'Antigo'}],materials:[{id:'old-material',block_id:'old-block',status:'solicitado',sap_code:'1'}],activity:history}));
  globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const store=await import(`../src/store.js?scenario=${scenario++}`);await store.closeBlock('old-block');
  const saved=JSON.parse(values.get('notaflow-v2-demo-v1'));assert.ok(saved.activity.some(event=>event.id==='antigo-1000'));assert.equal(saved.activity.length,1003);
  assert.equal((await store.loadAll()).activity.length,150);
});
test('etapas distinguem blocos em trabalho, pedidos e materiais recebidos',()=>{
  assert.equal(blockStage([]),'pending');assert.equal(blockStage([{status:'rascunho'}]),'pending');
  assert.equal(blockStage([{status:'solicitado'}]),'requested');assert.equal(blockStage([{status:'nota_recebida',invoice_id:'nf'}]),'received');
  assert.ok(isReceivedMaterial({status:'concluido'}));assert.ok(isReceivedMaterial({status:'solicitado',invoice_id:'nf'}));
});
