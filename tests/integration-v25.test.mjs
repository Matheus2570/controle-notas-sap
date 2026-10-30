import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const content=(file)=>readFileSync(fileURLToPath(new URL(file,root)),'utf8');
const sql=content('supabase/ATUALIZAR_HISTORICO_E_ARMAZENAMENTO.sql');
const jsx=content('src/App.jsx');
const store=content('src/store.js');
test('migração não apaga tabelas ou registros existentes',()=>{
 assert.doesNotMatch(sql,/\b(drop\s+table|truncate\s+table|delete\s+from|update\s+public\.nf_materials\s+set)\b/i);
 assert.match(sql,/create\s+or\s+replace\s+function\s+public\.nf_audit/i);
 assert.doesNotMatch(sql,/\b(old|new)\.number\b/i);
});
test('histórico compacto não grava snapshots e evita logs sem mudanças',()=>{
 assert.match(sql,/left\(v_subject\s*\|\|[^\n]*240\)/);
 assert.match(sql,/previous_data\s*-\s*'updated_at'/);
 assert.doesNotMatch(sql,/insert\s+into\s+public\.nf_activity[^;]*previous_data/i);
 assert.match(store,/\.limit\(150\)/);
 assert.match(jsx,/activityRows\.slice\(0,activityShown\)/);
});
test('consulta do armazenamento é restrita a admin e feita por RPC',()=>{
 assert.match(sql,/not\s+public\.nf_is_admin\(\)/i);
 assert.match(sql,/revoke\s+all\s+on\s+function\s+public\.nf_database_usage_bytes\(\)\s+from\s+anon/i);
 assert.match(sql,/pg_catalog\.pg_database_size\(pg_catalog\.current_database\(\)\)/);
 assert.match(store,/supabase\.rpc\('nf_database_usage_bytes'\)/);
 assert.match(jsx,/cloud&&canWrite&&<StoragePanel/);
});
