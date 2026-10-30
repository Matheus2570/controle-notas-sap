# NotaFlow — ajustes sobre o projeto original (29/10/2026)

Esta pasta foi reconstruída **a partir do RAR fornecido pelo usuário**, preservando as telas, os componentes, os estilos, o arquivo de dependências, os scripts e o restante do projeto. Não é um app substituto de 500 linhas. A pasta `src/App.jsx` continua com mais de 900 linhas extensas; a quantidade de linhas não mede quantas funções existem.

## O que foi corrigido

1. **Status individual:** Lançamentos > Blocos > Aplicar status ao bloco e Lançamentos > Planilha > Aplicar aos selecionados agora usam os IDs exatos dos materiais (`update_request_item_statuses`) e não mais atualizam todos os materiais de um pedido compartilhado.
2. **Notas fiscais:** a migração SQL atribui `nota_recebida` aos itens vinculados, corrige dados antigos pendentes que já tinham NF, volta para `solicitado` nos itens desvinculados e recalcula o número de NF no cabeçalho em edição/exclusão. Não altera os status dos materiais de outros blocos. A validação de vínculo também é feita no banco para impedir alteração de status de um material com NF vinculada.
3. **Filtros e ordenação da planilha:** a ordenação é executada no Supabase antes da paginação. O modo demonstração segue a mesma regra. A busca livre por código, Forms, material e NF usa `search_text`.
4. **Blocos:** filtro por situação/processo/site/período e ordenação visual dentro de cada bloco por SAP, Forms, descrição, data ou valor. Alterações visuais não reordenam dados salvos. Reordenação persistente continua disponível no modo manual.
5. **Página inicial:** filtros simples de busca e situação, ordenação por data/valor nos lançamentos recentes e botão **Ver todos na planilha** abrindo a tabela com os filtros completos.
6. **Consulta de pedido:** exibe o status próprio de cada material, além do status geral do pedido.
7. **Modo demonstração:** preserva status individuais ao editar o pedido e valida vínculos de nota antes de alterar status.
8. **Segurança e persistência:** SQL aditivo das tabelas de blocos com RLS por administrador. Mantida a trilha de auditoria já existente e os controles de permissão.

## ATENÇÃO — atualizar o seu Supabase existente

**Antes de executar SQL, faça um backup do banco pelo Supabase** e confirme que está no projeto correto. Não execute scripts de instalação que recriem estruturas nem apague suas tabelas.

Na aba **SQL Editor** do Supabase conectado ao aplicativo:

1. Execute `supabase/notaflow_blocos.sql` **somente se essas tabelas ainda não existirem**. É idempotente e mantém os blocos já cadastrados.
2. Execute **por último** `supabase/material_status_fix.sql`. Este script é a atualização atual do fluxo de notas; reaplique-o caso depois execute os scripts antigos `schema.sql`, `invoice_workflow.sql` ou `automation_workflow_upgrade.sql`.
3. Recarregue o aplicativo. Teste a alteração de um item de um bloco; confirme que o outro bloco permanece igual. Depois vincule uma nota de teste e confira `Nota recebida` apenas nos itens vinculados.

Ambos os scripts assumem que o banco já tem a configuração anterior de usuários, pedidos e notas fiscais, que acompanha este projeto. Se aparecer erro de tabela/função não encontrada, confira a versão base antes de prosseguir; **não execute scripts de criação cegamente em um banco de produção**.

### Instalar ou publicar

```bash
npm install
npm test
npm run dev
npm run build
```

Use o `.env.local` **que você já tem em sua máquina**, com URL e chave `anon`/publishable do Supabase, ou copie `.env.example` e configure essas variáveis. **Não envie `.env.local` para GitHub ou para terceiros**. A chave `service_role` não deve ficar no React.

### Testes realizados aqui

- Testes offline do modo demonstração: **4 aprovados**, cobrindo status por item, nota fiscal, busca/ordenação e preservação de estado ao editar.
- Sintaxe e transpilação estática JSX/JS: `src/App.jsx`, `src/api.js`, `src/main.jsx` sem erros.
- **Não foi possível validar `npm run build` completo**: instalação via npm expirou neste ambiente; os arquivos de dependências não estão incluídos neste ZIP. Testes no Supabase real não foram executados.

### Arquivos do RAR que NÃO estão no ZIP

- `.env.local`: arquivo privado de configuração com dados de acesso.
- `.git/`: histórico local do repositório, que não é necessário para executar o código.
- `node_modules/` e caches: devem ser reinstalados via `npm install` para sua plataforma (evita incluir binários do Windows ou caches de versões diferentes).

Não foram removidas funcionalidades, registros de banco nem telas do código-fonte. As alterações SQL não fazem `DROP TABLE`, `TRUNCATE` ou `DELETE` de registros operacionais.
