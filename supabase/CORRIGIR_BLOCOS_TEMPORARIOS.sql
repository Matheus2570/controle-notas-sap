-- NotaFlow: atualização incremental de blocos para bancos EXISTENTES.
-- Execute este arquivo inteiro uma vez no SQL Editor antes de publicar o React.
-- Não recria tabelas, não reorganiza registros existentes e não altera RLS/perfis.
-- Pode ser reaplicado. Nenhuma função de manutenção é chamada pela migração.
BEGIN;

ALTER TABLE public.nf_materials
  ADD COLUMN IF NOT EXISTS auto_group_on_insert boolean NOT NULL DEFAULT true;

-- Número livre entre os nomes ATUAIS, inclusive nomes legados com sufixo.
-- O lock é compartilhado por agrupamento, movimentação, encerramento e ordem.
CREATE OR REPLACE FUNCTION public.nf_next_block_name()
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_number integer;
BEGIN
  IF current_user NOT IN ('postgres','service_role') AND NOT public.nf_is_admin() THEN
    RAISE EXCEPTION 'Somente administradores podem criar blocos';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(936100, 4204);
  SELECT min(candidate) INTO v_number
  FROM pg_catalog.generate_series(1,(SELECT count(*)::integer+1 FROM public.nf_blocks)) candidate
  WHERE NOT EXISTS (
    SELECT 1 FROM public.nf_blocks b
    WHERE substring(trim(b.name) FROM '(?i)^BLOCO[[:space:]]+([0-9]+)(?:[[:space:]]*[—–-].*)?$')::numeric=candidate
  );
  RETURN 'BLOCO '||lpad(v_number::text,greatest(3,length(v_number::text)),'0');
END;
$$;
REVOKE ALL ON FUNCTION public.nf_next_block_name() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nf_next_block_name() TO authenticated;

-- Não modifica nomes existentes. Impede novas colisões de numeração automática,
-- inclusive entre cadastro manual e automático em sessões concorrentes.
CREATE OR REPLACE FUNCTION public.nf_guard_block_name()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_number numeric;
BEGIN
  IF tg_op='UPDATE' THEN
    IF new.name IS NOT DISTINCT FROM old.name THEN RETURN new; END IF;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(936100, 4204);
  v_number:=substring(trim(new.name) FROM '(?i)^BLOCO[[:space:]]+([0-9]+)(?:[[:space:]]*[—–-].*)?$')::numeric;
  IF v_number IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.nf_blocks b WHERE b.id<>new.id
    AND substring(trim(b.name) FROM '(?i)^BLOCO[[:space:]]+([0-9]+)(?:[[:space:]]*[—–-].*)?$')::numeric=v_number
  ) THEN
    RAISE EXCEPTION 'Já existe um bloco ativo com este número. Escolha outro nome.';
  END IF;
  RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS nf_guard_block_name_trigger ON public.nf_blocks;
CREATE TRIGGER nf_guard_block_name_trigger
BEFORE INSERT OR UPDATE OF name ON public.nf_blocks
FOR EACH ROW EXECUTE FUNCTION public.nf_guard_block_name();

-- Núcleo compartilhado. NUNCA varre materiais fora da lista explícita de IDs.
-- A ação manual fornece os elegíveis atuais; o trigger fornece só os inseridos.
CREATE OR REPLACE FUNCTION public.nf_group_materials(p_material_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_item record;
  v_block uuid;
  v_slot integer;
  v_position integer;
  v_done integer:=0;
BEGIN
  IF current_user NOT IN ('postgres','service_role') AND NOT public.nf_is_admin() THEN
    RAISE EXCEPTION 'Somente administradores podem organizar materiais';
  END IF;
  IF coalesce(cardinality(p_material_ids),0)=0 THEN RETURN 0; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(936100, 4204);
  FOR v_item IN
    SELECT m.id,m.site_id,m.process,m.status FROM public.nf_materials m
    WHERE m.id=ANY(p_material_ids) AND m.block_id IS NULL
      AND m.status IN ('rascunho','solicitado')
      AND NOT EXISTS (SELECT 1 FROM public.nf_invoice_materials im WHERE im.material_id=m.id)
    ORDER BY m.site_id,
      CASE m.process WHEN 'cnc' THEN 0 WHEN '3d' THEN 1 WHEN 'outro' THEN 2 ELSE 3 END,
      m.created_at,m.id
    FOR UPDATE OF m
  LOOP
    v_block:=NULL;
    SELECT b.id,coalesce((SELECT max(x.position)+1 FROM public.nf_materials x WHERE x.block_id=b.id),0)
      INTO v_block,v_slot
    FROM public.nf_blocks b
    WHERE b.auto_created=true AND b.site_id IS NOT DISTINCT FROM v_item.site_id
      AND b.process=v_item.process
      AND (SELECT count(*) FROM public.nf_materials x WHERE x.block_id=b.id)<4
      AND NOT EXISTS (
        SELECT 1 FROM public.nf_materials x WHERE x.block_id=b.id AND (
          x.process IS DISTINCT FROM v_item.process OR x.site_id IS DISTINCT FROM v_item.site_id
          OR x.status IS DISTINCT FROM v_item.status
          OR EXISTS (SELECT 1 FROM public.nf_invoice_materials im WHERE im.material_id=x.id)
        )
      )
    ORDER BY b.position,b.created_at,b.id LIMIT 1 FOR UPDATE OF b;
    IF v_block IS NULL THEN
      SELECT coalesce(max(position),-1)+1 INTO v_position FROM public.nf_blocks;
      INSERT INTO public.nf_blocks(name,position,auto_created,process,site_id)
      VALUES(public.nf_next_block_name(),v_position,true,v_item.process,v_item.site_id)
      RETURNING id INTO v_block;
      v_slot:=0;
    END IF;
    UPDATE public.nf_materials SET block_id=v_block,position=v_slot
    WHERE id=v_item.id AND block_id IS NULL;
    v_done:=v_done+1;
  END LOOP;
  RETURN v_done;
END;
$$;
REVOKE ALL ON FUNCTION public.nf_group_materials(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nf_group_materials(uuid[]) TO authenticated;

-- RPC público existente: somente o botão manual chama esta varredura.
CREATE OR REPLACE FUNCTION public.nf_autogroup_materials()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ids uuid[];
BEGIN
  IF current_user NOT IN ('postgres','service_role') AND NOT public.nf_is_admin() THEN
    RAISE EXCEPTION 'Somente administradores podem organizar materiais';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(936100, 4204);
  SELECT array_agg(m.id) INTO v_ids FROM public.nf_materials m
  WHERE m.block_id IS NULL AND m.status IN ('rascunho','solicitado')
    AND NOT EXISTS (SELECT 1 FROM public.nf_invoice_materials im WHERE im.material_id=m.id);
  RETURN public.nf_group_materials(v_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.nf_autogroup_materials() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nf_autogroup_materials() TO authenticated;

-- Tabela de transição contém apenas as linhas realmente INSERIDAS nesta operação.
-- ON CONFLICT DO UPDATE não inclui materiais antigos nesta relação.
CREATE OR REPLACE FUNCTION public.nf_autogroup_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_ids FROM nf_inserted_materials
  WHERE block_id IS NULL AND auto_group_on_insert AND status IN ('rascunho','solicitado');
  IF coalesce(cardinality(v_ids),0)>0 THEN
    PERFORM public.nf_group_materials(v_ids);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS nf_autogroup_after_insert ON public.nf_materials;
CREATE TRIGGER nf_autogroup_after_insert AFTER INSERT ON public.nf_materials
REFERENCING NEW TABLE AS nf_inserted_materials
FOR EACH STATEMENT EXECUTE FUNCTION public.nf_autogroup_on_insert();

-- Encerramento atômico: altera SOMENTE block_id e exclui SOMENTE o agrupamento.
-- As notas e nf_invoice_materials continuam vinculadas aos mesmos material_id.
CREATE OR REPLACE FUNCTION public.nf_close_block(p_block_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT public.nf_is_admin() THEN RAISE EXCEPTION 'Somente administradores podem encerrar blocos'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(936100, 4204);
  PERFORM 1 FROM public.nf_blocks WHERE id=p_block_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bloco não encontrado. Atualize os dados.'; END IF;
  UPDATE public.nf_materials SET block_id=NULL WHERE block_id=p_block_id;
  DELETE FROM public.nf_blocks WHERE id=p_block_id;
END;
$$;
REVOKE ALL ON FUNCTION public.nf_close_block(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nf_close_block(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.nf_reorder_blocks(p_block_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT public.nf_is_admin() THEN RAISE EXCEPTION 'Somente administradores podem ordenar blocos'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(936100, 4204);
  IF coalesce(cardinality(p_block_ids),0)<>(SELECT count(*) FROM public.nf_blocks)
    OR (SELECT count(DISTINCT x) FROM unnest(p_block_ids) x)<>(SELECT count(*) FROM public.nf_blocks)
    OR EXISTS(SELECT 1 FROM unnest(p_block_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.nf_blocks b WHERE b.id=x)) THEN
    RAISE EXCEPTION 'A lista de blocos mudou. Atualize os dados.';
  END IF;
  UPDATE public.nf_blocks b SET position=chosen.ord::integer-1
  FROM unnest(p_block_ids) WITH ORDINALITY AS chosen(id,ord)
  WHERE b.id=chosen.id AND b.position IS DISTINCT FROM chosen.ord::integer-1;
END;
$$;
REVOKE ALL ON FUNCTION public.nf_reorder_blocks(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nf_reorder_blocks(uuid[]) TO authenticated;

COMMIT;
