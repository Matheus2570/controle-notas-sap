import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAll,mergeView} from '../src/store.js';

function reader(expectedTable,records,columns){
  const calls=[];
  return {calls,client:{from(table){
    assert.equal(table,expectedTable);
    const orders=[];
    const query={select(selection){assert.equal(selection,'*');return query;},order(column,options){
      assert.ok(columns.includes(column),`column ${table}.${column} does not exist`);
      assert.equal(options.ascending,true);orders.push(column);return query;
    },async range(start,end){calls.push({orders:[...orders],start,end});
      const sorted=[...records].sort((a,b)=>{for(const column of orders){const result=String(a[column]).localeCompare(String(b[column]));if(result)return result;}return 0;});
      return {data:sorted.slice(start,end+1),error:null};
    }};return query;
  }}};
}
test('carrega 1501 vínculos sem id, ordenados pela chave composta em todas as páginas',async()=>{
  const links=Array.from({length:1501},(_,i)=>({invoice_id:`nf-${String(Math.floor(i/4)).padStart(4,'0')}`,material_id:`m-${String(i).padStart(4,'0')}`,prior_status:'solicitado'})).reverse();
  const before=structuredClone(links);const mock=reader('nf_invoice_materials',links,['invoice_id','material_id','prior_status']);
  const loaded=await fetchAll('invoice_materials',mock.client);
  assert.equal(loaded.length,1501);assert.equal(new Set(loaded.map(l=>`${l.invoice_id}/${l.material_id}`)).size,1501);
  assert.deepEqual(mock.calls.map(c=>c.orders),Array.from({length:3},()=>['invoice_id','material_id']));
  assert.deepEqual(mock.calls.map(c=>[c.start,c.end]),[[0,749],[750,1499],[1500,2249]]);
  assert.deepEqual(links,before);
  const raw={sites:[],blocks:[],activity:[],materials:loaded.map(l=>({id:l.material_id,block_id:null,status:'nota_recebida'})),invoices:[...new Set(loaded.map(l=>l.invoice_id))].map(id=>({id,number:`000${id}`,access_key:'0'.repeat(44)})),invoice_materials:loaded};
  const view=mergeView(raw);assert.ok(view.materials.every(m=>m.invoice_id&&m.invoice_number));assert.equal(view.invoices.reduce((sum,i)=>sum+i.material_ids.length,0),1501);
});
test('tabelas com id continuam usando sua própria chave para paginação',async()=>{
  const mock=reader('nf_materials',[{id:'b'},{id:'a'}],['id']);
  assert.deepEqual(await fetchAll('materials',mock.client),[{id:'a'},{id:'b'}]);assert.deepEqual(mock.calls[0].orders,['id']);
});
test('erro de leitura fiscal é propagado, sem devolver vínculos incompletos',async()=>{
  const query={select(){return query;},order(){return query;},async range(){return {data:null,error:{message:'Falha ao consultar vínculos'}};}};
  await assert.rejects(()=>fetchAll('invoice_materials',{from:()=>query}),/Falha ao consultar vínculos/);
});
