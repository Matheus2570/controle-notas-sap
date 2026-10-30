# NotaFlow 2.0 — Reconstruído do zero

Aplicativo React + Vite + Supabase para controle de materiais SAP, Forms, blocos de trabalho e notas fiscais. Esta é uma **nova arquitetura**; não é uma atualização incremental da versão antiga.

## O que está incluído

- Visão geral com indicadores e últimos lançamentos, botão **Ver todos** funcional.
- Lançamentos: cadastro, edição, exclusão, busca global, filtros por status/processo/site/data/NF, ordenação **antes** da paginação, exportação CSV e importação por copiar/colar do Excel.
- Blocos: cada material possui um `block_id` e status **próprio**, seleção por identificador único, criação/renomeação, movimentação, alteração do status apenas dos itens do bloco selecionado.
- Notas fiscais: número, data, chave de 44 dígitos opcional, vínculo de **1 a 4 materiais**; sincronização de status ao criar, editar ou excluir. Exclusão de nota **não exclui os materiais**.
- Consulta SAP / Forms, histórico e cadastro de sites.
- Login Supabase Auth, permissões `admin` / `viewer`, RLS; demo local automática sem Supabase.

## Primeiro teste (sem banco)

1. Instale Node.js 20+ e execute `npm install` e `npm run dev`.
2. Acesse o endereço mostrado pelo Vite. Sem `.env`, você verá o **modo demonstração**.
3. Vá em **Configurações** e adicione um site. Depois cadastre materiais em **Lançamentos**, organize os **Blocos** e registre as **Notas fiscais**.
4. O modo demonstração salva os dados localmente no navegador (não na nuvem). A opção **Zerar demonstração** apaga apenas esses dados locais, com confirmação.

## Banco Supabase completamente novo

**Recomendado: crie um novo projeto Supabase.** Assim o banco começa realmente vazio, sem risco de apagar os registros de outra aplicação. Não execute os scripts legados `schema.sql`, `roles_upgrade.sql` etc. nesta instalação nova.

1. Crie o projeto em <https://supabase.com>.
2. No SQL Editor, execute o arquivo inteiro `supabase/CRIAR_BANCO_NOVO.sql`.
3. Vá em **Authentication → Users** e crie os usuários. Desative cadastro público se o app for interno.
4. Abra `supabase/PROMOVER_ADMIN.sql`, substitua `SEU_EMAIL_AQUI@EXEMPLO.COM` e execute no SQL Editor. O primeiro admin **não é criado automaticamente** por segurança.
5. Na raiz do projeto, crie `.env.local` (não publique esse arquivo):

   ```env
   VITE_SUPABASE_URL=https://seu-projeto.supabase.co
   VITE_SUPABASE_ANON_KEY=sua-chave-publishable-ou-anon
   ```

6. Reinicie `npm run dev` e faça login. O perfil admin cadastra e edita; viewer apenas lê. **Nunca** use `service_role`, a senha do banco ou `secret` no navegador.

### Tabelas

`nf_profiles`, `nf_sites`, `nf_blocks`, `nf_materials`, `nf_invoices`, `nf_invoice_materials`, `nf_activity`. Usam prefixo `nf_` para não colidir com versões antigas. O script **não contém** `DROP TABLE`, `TRUNCATE` nem exclusão em massa. O Supabase Auth mantém seus próprios usuários; criá-los no painel é etapa obrigatória.

### Regras importantes

- Cada material tem status individual, por isso a alteração de um bloco não altera os materiais de outros blocos, mesmo que compartilhem SAP ou Forms.
- `nf_invoice_materials` impõe vínculo único por material. O trigger de validação usa bloqueio de linha para garantir o máximo de quatro materiais por NF, mesmo com edições concorrentes.
- O RPC `nf_save_invoice` grava a nota e os vínculos em **uma transação** e as políticas RLS impedem que um `viewer` grave mesmo manipulando JavaScript.
- Ao excluir ou remover material de uma nota, seu status anterior é restaurado automaticamente. Um material com NF vinculada pode ficar `nota_recebida` ou `concluido`, mas não pode voltar para `rascunho`/`solicitado` sem desvincular a nota.
- Exclusão de material que está em nota é impedida pelo banco.
- Audite operações em `nf_activity`; os registros são gerados por triggers, sem permissão direta de escrita no navegador.

### Uso da importação do Excel

Cole **sem cabeçalho**, na ordem: SAP | Forms | Descrição | Processo (`3d`, `cnc`, `outro`) | Quantidade | Valor unitário. O valor pode conter vírgula decimal. Confirme o preview antes de gravar.

## Publicação

`npm run build` gera a pasta `dist`. Compatível com Cloudflare Pages (build `npm run build`, saída `dist`) ou Vercel. Configure as duas variáveis `VITE_` no serviço. Use as regras de acesso compatíveis com dados corporativos e consulte as políticas da sua empresa antes de publicar informações internas. O modo demo não compartilha dados entre computadores.

## Verificações

`npm test` executa os testes de regra de negócio. `npm run build` compila a interface. Antes de usar em produção, teste também com contas separadas `admin`/`viewer` e Supabase real, incluindo NF criada, editada e excluída. A compilação local não substitui esses testes no banco remoto.

## Migração de versões antigas

Esta versão **não apaga** dados antigos nem importa automaticamente os bancos anteriores. Caso algum banco seja recuperado, faça backup e trate a importação como tarefa separada: o modelo dos dados mudou. Não execute scripts antigos sobre o projeto novo.

## Atualização 2.4 — fluxo por bloco e filtros

Para atualizar um banco **já existente**, siga `ATUALIZACAO-V2.4-LEIA-PRIMEIRO.md`. Nesta versão, cada bloco de até quatro é solicitado no SAP antes de receber uma NF; o botão de registrar nota carrega automaticamente os materiais desse bloco. CNC e 3D têm etiquetas coloridas. A etapa **Concluído** não é automática. **Não recrie o banco existente.**

## Atualização v2.5: histórico compacto + armazenamento

Leia **`ATUALIZACAO-V2.5-HISTORICO-ARMAZENAMENTO.md`**. Em banco existente, execute somente `supabase/ATUALIZAR_HISTORICO_E_ARMAZENAMENTO.sql` antes de usar o novo painel de espaço em Configurações. A versão preserva todos os dados, telas e o fluxo SAP → bloco → NF da v2.4.
