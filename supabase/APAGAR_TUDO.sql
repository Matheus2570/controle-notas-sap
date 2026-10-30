-- ================================================================
-- NOTAFLOW | APAGAR TUDO (SOMENTE DADOS/ESTRUTURA DO NOTAFLOW 2.x)
-- ================================================================
-- PERIGO: EXCLUI DEFINITIVAMENTE materiais, blocos, notas fiscais,
-- vinculos, sites, historico, perfis nf_profiles e configuracao nf_*.
-- NAO existe desfazer apos COMMIT: faca backup primeiro!
-- Nao exclui usuarios/senhas do Supabase Authentication (auth.users),
-- outros bancos/projetos Supabase, extensoes ou tabelas de outros apps.
-- NAO apaga tabelas antigas sem prefixo nf_ (requests, app_users etc).
-- Ao reinstalar, devera promover o admin novamente em nf_profiles.
--
-- PROTECAO: so roda apos trocar NAO por SIM na linha indicada abaixo.
-- Passo 1: confira que esta no projeto Supabase correto.
-- Passo 2: exporte/backupe os dados que deseja preservar.
-- Passo 3: altere a confirmacao para 'SIM' e execute TUDO.
-- Passo 4: execute BANCO.sql para recriar a estrutura vazia.
-- ================================================================
BEGIN;

DO $notaflow_reset$
BEGIN
  -- TROQUE 'NAO' POR 'SIM' somente quando quiser zerar de verdade.
  IF 'NAO' <> 'SIM' THEN
    RAISE EXCEPTION 'RESET BLOQUEADO: altere NAO para SIM no arquivo APAGAR_TUDO.sql antes de executar.';
  END IF;
END;
$notaflow_reset$;

-- Remove o trigger do Supabase Auth que cria perfis da aplicacao.
DROP TRIGGER IF EXISTS nf_profile_signup ON auth.users;

-- Drops em conjunto respeitam dependencias internas sem CASCADE:
-- se outro sistema depender dessas tabelas, o reset aborta com erro.
DROP TABLE IF EXISTS
  public.nf_invoice_materials,
  public.nf_invoices,
  public.nf_materials,
  public.nf_blocks,
  public.nf_sites,
  public.nf_activity,
  public.nf_profiles;

-- Funcoes exclusivas do NotaFlow 2.x.
DROP FUNCTION IF EXISTS public.nf_database_usage_bytes();
DROP FUNCTION IF EXISTS public.nf_autogroup_on_insert();
DROP FUNCTION IF EXISTS public.nf_autogroup_materials();
DROP FUNCTION IF EXISTS public.nf_move_materials(uuid[],uuid);
DROP FUNCTION IF EXISTS public.nf_guard_block_capacity();
DROP FUNCTION IF EXISTS public.nf_save_invoice(uuid,text,text,date,text,uuid[]);
DROP FUNCTION IF EXISTS public.nf_before_invoice_link();
DROP FUNCTION IF EXISTS public.nf_after_invoice_link();
DROP FUNCTION IF EXISTS public.nf_guard_linked_status();
DROP FUNCTION IF EXISTS public.nf_audit();
DROP FUNCTION IF EXISTS public.nf_stamp();
DROP FUNCTION IF EXISTS public.nf_is_admin();
DROP FUNCTION IF EXISTS public.nf_create_profile();

COMMIT;

-- Se aparecer Success, a estrutura nf_* foi removida.
-- Execute BANCO.sql para restaurar as tabelas/funcoes, VAZIAS.
-- Os usuarios do Authentication continuam existentes, com perfil
-- viewer ate que voce promova seu administrador novamente.
