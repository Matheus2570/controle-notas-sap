import {test,before,beforeEach,afterEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

// PostgreSQL real em WebAssembly, somente em memória. Não acessa o Supabase.
const banco=readFileSync(new URL('../supabase/BANCO.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const migration=readFileSync(new URL('../supabase/CORRIGIR_BLOCOS_TEMPORARIOS.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const core=migration.slice(migration.indexOf('ALTER TABLE'),migration.lastIndexOf('COMMIT;'));
const adminId='10000000-0000-0000-0000-000000000001';
const viewerId='10000000-0000-0000-0000-000000000002';
const siteId='20000000-0000-0000-0000-000000000001';
let db,sequence=0;
const rows=async(sql,params=[]) => (await db.query(sql,params)).rows;
const material=(process='cnc',extra={})=>({id:crypto.randomUUID(),site_id:siteId,sap_code:`SAP-${++sequence}`,forms_code:`F-${sequence}`,description:`Peça ${sequence}`,process,quantity:2,unit_price:12.5,status:'rascunho',block_id:null,auto_group_on_insert:true,notes:'Preservar',requested_on:'2026-11-11',...extra});
async function insert(items){
  const columns=Object.keys(items[0]);const params=[];
  const values=items.map(item=>`(${columns.map(column=>{params.push(item[column]);return `$${params.length}`;}).join(',')})`).join(',');
  await db.query(`INSERT INTO public.nf_materials(${columns.join(',')}) VALUES ${values}`,params);
}
const materials=()=>rows('SELECT * FROM public.nf_materials ORDER BY sap_code');
const blocks=()=>rows('SELECT * FROM public.nf_blocks ORDER BY position,created_at,id');
async function expectFailure(sql,params,pattern){
  await db.exec('SAVEPOINT expected_failure');
  try{await assert.rejects(()=>db.query(sql,params),pattern);}
  finally{await db.exec('ROLLBACK TO SAVEPOINT expected_failure; RELEASE SAVEPOINT expected_failure');}
}
before(async()=>{
  db=new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
  `);
  // gen_random_uuid é nativa no PostgreSQL; o bundle WASM dispensa pgcrypto.
  await db.exec(banco.replace('create extension if not exists pgcrypto;',''));
  await db.exec(migration);await db.exec(migration);
  await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)',[adminId,'admin@teste.local',viewerId,'viewer@teste.local']);
  await db.query("UPDATE public.nf_profiles SET role='admin' WHERE user_id=$1",[adminId]);
  await db.query('INSERT INTO public.nf_sites(id,name) VALUES($1,$2)',[siteId,'Site de teste']);
});
beforeEach(async()=>{
  await db.exec('BEGIN; SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[adminId]);
});
afterEach(async()=>{await db.exec('ROLLBACK');});
after(async()=>{await db?.close();});

test('PostgreSQL: importação de 4 CNC e 1 3D agrupa apenas o lote novo',async()=>{
  const batch=[...Array.from({length:4},()=>material()),material('3d')];await insert(batch);
  const groups=await blocks(),items=await materials();assert.equal(groups.length,2);
  assert.deepEqual(groups.map(b=>b.name),['BLOCO 001','BLOCO 002']);
  for(const block of groups){const members=items.filter(m=>m.block_id===block.id);assert.ok(members.length<=4);assert.equal(new Set(members.map(m=>m.process)).size,1);}
  assert.deepEqual(groups.map(b=>items.filter(m=>m.block_id===b.id).length),[4,1]);
});
test('PostgreSQL: DELETE de bloco preserva materiais e novo cadastro não os recupera',async()=>{
  const old=[material(),material()];await insert(old);const [removed]=await blocks();
  await db.query('DELETE FROM public.nf_blocks WHERE id=$1',[removed.id]);
  const fresh=material();await insert([fresh]);const all=await materials();
  for(const item of old)assert.equal(all.find(m=>m.id===item.id).block_id,null);
  assert.ok(all.find(m=>m.id===fresh.id).block_id);assert.equal((await blocks())[0].name,'BLOCO 001');
  assert.equal(all.length,3);assert.ok((await blocks()).every(b=>b.id!==removed.id));
});
test('PostgreSQL: removidos manualmente não voltam em INSERT ou UPSERT de outro material',async()=>{
  const old=material();await insert([old]);await db.query('SELECT public.nf_move_materials($1,NULL)',[[old.id]]);
  await db.query("INSERT INTO public.nf_materials(id,sap_code,notes) VALUES($1,$2,'editado') ON CONFLICT(id) DO UPDATE SET notes=excluded.notes",[old.id,old.sap_code]);
  await insert([material('3d')]);assert.equal((await materials()).find(m=>m.id===old.id).block_id,null);
  await db.query('SELECT public.nf_autogroup_materials()');assert.ok((await materials()).find(m=>m.id===old.id).block_id);
});
test('PostgreSQL: NF por material sobrevive ao encerramento, com códigos repetidos e status independentes',async()=>{
  const a=material(),b=material('3d',{sap_code:a.sap_code,forms_code:a.forms_code});await insert([a,b]);
  await db.query("UPDATE public.nf_materials SET status='solicitado' WHERE id=ANY($1)",[[a.id,b.id]]);
  const [{id:invoiceId}]=await rows('SELECT public.nf_save_invoice(NULL,$1,$2,$3,$4,$5) AS id',['12345','1'.repeat(44),'2026-11-11','NF de teste',[a.id]]);
  const invoices=await rows('SELECT * FROM public.nf_invoices'),links=await rows('SELECT * FROM public.nf_invoice_materials');
  const before=await materials();const blockId=before.find(m=>m.id===a.id).block_id;
  await db.query('SELECT public.nf_close_block($1)',[blockId]);await insert([material()]);await db.query('SELECT public.nf_autogroup_materials()');
  assert.deepEqual(await rows('SELECT * FROM public.nf_invoices'),invoices);assert.deepEqual(await rows('SELECT * FROM public.nf_invoice_materials'),links);
  assert.equal(links[0].invoice_id,invoiceId);const after=await materials();
  assert.equal(after.find(m=>m.id===a.id).block_id,null);assert.equal(after.find(m=>m.id===a.id).status,'nota_recebida');assert.equal(after.find(m=>m.id===b.id).status,'solicitado');
  for(const old of before){const current=after.find(m=>m.id===old.id);for(const field of ['id','sap_code','forms_code','description','process','quantity','unit_price','status','notes','site_id','requested_on'])assert.deepEqual(current[field],old[field]);}
  assert.ok((await rows("SELECT 1 FROM public.nf_activity WHERE entity='nf_blocks' AND action='delete' AND entity_id=$1",[blockId])).length);
});
test('PostgreSQL: NF, concluídos e cancelados ficam fora das duas organizações',async()=>{
  const done=material('cnc',{status:'concluido'}),cancelled=material('cnc',{status:'cancelado'}),unassigned=material('3d',{auto_group_on_insert:false});
  await insert([done,cancelled,unassigned]);assert.equal((await blocks()).length,0);
  await insert([material()]);await db.query('SELECT public.nf_autogroup_materials()');
  const all=await materials();assert.equal(all.find(m=>m.id===done.id).block_id,null);assert.equal(all.find(m=>m.id===cancelled.id).block_id,null);assert.ok(all.find(m=>m.id===unassigned.id).block_id);
});
test('PostgreSQL: todos os blocos excluídos reiniciam em 001 e lacunas são reutilizadas sem renomear',async()=>{
  await db.exec("INSERT INTO public.nf_blocks(name,position) VALUES('BLOCO 001 — CNC',40),('BLOCO 003',90),('CNC — Urgente',100)");
  await insert([material()]);assert.deepEqual((await blocks()).map(b=>b.name),['BLOCO 001 — CNC','BLOCO 003','CNC — Urgente','BLOCO 002']);
  for(const block of await blocks())await db.query('SELECT public.nf_close_block($1)',[block.id]);
  await insert([material('3d')]);assert.equal((await blocks())[0].name,'BLOCO 001');
});
test('PostgreSQL: Misto — Pt2 aceita CNC/3D, preserva nome e limita quatro em RPC e API direta',async()=>{
  const items=[material(),material('3d'),material('outro'),material('3d')];await insert(items);
  const blockId=(await materials()).find(m=>m.id===items[0].id).block_id;
  await db.query("UPDATE public.nf_blocks SET name='Misto — Pt2',auto_created=false WHERE id=$1",[blockId]);
  await db.query('SELECT public.nf_move_materials($1,$2)',[items.slice(0,4).map(m=>m.id),blockId]);
  const fifth=material('3d');await insert([fifth]);
  await expectFailure('SELECT public.nf_move_materials($1,$2)',[[fifth.id],blockId],/4 materiais/);
  await expectFailure('UPDATE public.nf_materials SET block_id=$1 WHERE id=$2',[blockId,fifth.id],/4 materiais/);
  assert.equal((await blocks()).find(b=>b.id===blockId).name,'Misto — Pt2');assert.equal((await materials()).filter(m=>m.block_id===blockId).length,4);
});
test('PostgreSQL: organização não preenche blocos misturados, faturados ou com outra etapa',async()=>{
  const a=material(),b=material('3d');await insert([a,b]);
  const blockId=(await materials()).find(m=>m.id===a.id).block_id;
  await db.query('SELECT public.nf_move_materials($1,$2)',[[b.id],blockId]);
  const fresh=material();await insert([fresh]);assert.notEqual((await materials()).find(m=>m.id===fresh.id).block_id,blockId);
  const nextBlock=(await materials()).find(m=>m.id===fresh.id).block_id;await db.query("UPDATE public.nf_materials SET status='solicitado' WHERE id=$1",[fresh.id]);
  const next=material();await insert([next]);assert.notEqual((await materials()).find(m=>m.id===next.id).block_id,nextBlock);
});
test('PostgreSQL: ordem é persistida sem alterar nomes; números automáticos não duplicam',async()=>{
  await insert([material(),material('3d')]);const before=await blocks(),ids=before.map(b=>b.id).reverse();
  await db.query('SELECT public.nf_reorder_blocks($1)',[ids]);assert.deepEqual((await blocks()).map(b=>b.id),ids);
  for(const old of before)assert.equal((await blocks()).find(b=>b.id===old.id).name,old.name);
  await expectFailure('INSERT INTO public.nf_blocks(name) VALUES($1)',[before[0].name],/Já existe/);
  await expectFailure('SELECT public.nf_reorder_blocks($1)',[[ids[0]]],/lista de blocos mudou/);
  assert.deepEqual((await blocks()).map(b=>b.id),ids);
});
test('PostgreSQL: viewer lê e não consegue agrupar, mover, encerrar, ordenar ou cadastrar',async()=>{
  const item=material();await insert([item]);const [block]=await blocks();
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewerId]);assert.equal((await materials()).length,1);
  await expectFailure('SELECT public.nf_autogroup_materials()',[],/administradores/);
  await expectFailure('SELECT public.nf_group_materials($1)',[[item.id]],/administradores/);
  await expectFailure('SELECT public.nf_close_block($1)',[block.id],/administradores/);
  await expectFailure('SELECT public.nf_move_materials($1,NULL)',[[item.id]],/administradores/);
  await expectFailure('SELECT public.nf_reorder_blocks($1)',[[block.id]],/administradores/);
  await expectFailure("INSERT INTO public.nf_materials(sap_code) VALUES('NÃO PERMITIDO')",[],/row-level security/);
  await db.query('DELETE FROM public.nf_blocks WHERE id=$1',[block.id]);assert.equal((await blocks()).length,1);
});
test('PostgreSQL: migração reaplicada preserva todos os dados, políticas e usuários',async()=>{
  const item=material();await insert([item]);await db.query("UPDATE public.nf_materials SET status='solicitado' WHERE id=$1",[item.id]);
  await db.query('SELECT public.nf_save_invoice(NULL,$1,$2,$3,$4,$5)',['88','','2026-11-11','',[item.id]]);
  await db.exec('RESET ROLE');
  const snapshot=async()=>{
    const result={};for(const table of ['nf_profiles','nf_sites','nf_blocks','nf_materials','nf_invoices','nf_invoice_materials','nf_activity'])result[table]=await rows(`SELECT * FROM public.${table} ORDER BY 1`);
    result.users=await rows('SELECT * FROM auth.users ORDER BY id');result.policies=await rows('SELECT * FROM pg_policies ORDER BY policyname');return result;
  };
  const before=await snapshot();await db.exec(core);await db.exec(core);assert.deepEqual(await snapshot(),before);
  assert.ok(banco.includes(core.trim()),'Instalação nova e migração devem conter a mesma correção');
});
