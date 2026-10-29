# Segurança e operação — NotaFlow

## Antes de usar com dados corporativos

- Obtenha autorização da empresa/TI para armazenar códigos SAP, Forms, preços e observações no serviço escolhido.
- Use um projeto Supabase dedicado e mantenha o repositório GitHub privado.
- Desative o cadastro público no Supabase Auth e crie usuários manualmente.
- Promova somente sua conta para `admin` via SQL Editor. Os demais ficam como `viewer`.
- Use no frontend somente a chave pública `publishable`/`anon`. Nunca inclua `service_role`, senha do banco ou tokens privados em variáveis `VITE_`.
- Não publique `.env`, backups, exports ou dados reais em issues/commits.
- Teste com duas sessões: confirme que o admin salva e o viewer recebe erro ao tentar gravar diretamente na API.
- Exporte os dados de forma periódica e mantenha uma cópia em local autorizado pela empresa. CSV é útil para consulta, mas não substitui um backup completo do banco.

## O que o aplicativo protege

- Autenticação por e-mail e senha via Supabase Auth.
- Políticas RLS para leitura autenticada e escrita apenas para administradores.
- Gravação transacional do pedido e seus itens.
- Trilha de auditoria de alterações em pedidos e materiais.

## Limites conhecidos

- O modo demonstração usa `localStorage` no navegador e não é compartilhado nem protegido como o banco online. Não use dados reais nesse modo.
- A chave pública do Supabase é visível no navegador por projeto. A segurança depende das políticas RLS e das permissões corretas, não de esconder essa chave.
- Não há edição colaborativa em tempo real nem resolução de conflitos entre dois administradores editando simultaneamente.


## Dados de notas fiscais (v1.3)

- O cabeçalho fiscal e a chave de acesso ficam em `invoices`, visíveis somente a usuários autenticados.
- `invoice_items` liga a nota a no máximo quatro materiais; a restrição também é validada por trigger no PostgreSQL.
- Cada material pode estar associado a apenas uma nota por vez. A chave de acesso é validada como 44 dígitos e é única.
- Materiais já vinculados não podem ser apagados ou ter SAP, Forms, descrição, processo, quantidade ou valor alterados até que a nota seja desvinculada. Site e data do pedido também ficam protegidos.
- O visualizador pode consultar/copiar a chave, mas não criar, editar, vincular ou excluir notas. A política RLS e as funções PostgreSQL reforçam essa separação.
- Não use dados fiscais reais da empresa em projeto pessoal sem autorização expressa de TI/Segurança da Informação.
