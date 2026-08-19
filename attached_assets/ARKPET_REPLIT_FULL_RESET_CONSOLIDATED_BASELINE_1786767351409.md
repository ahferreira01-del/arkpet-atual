# ARKPET
# REPLIT FULL BASE RESET / REBUILD / CONSOLIDATED VERSION ALIGNMENT

# CONTEXTO
# ESTA INSTÂNCIA DO REPLIT JÁ POSSUÍA UMA VERSÃO ANTERIOR DO ARKPET,
# MAS O BANCO ATUAL É APENAS UMA BASE DE TESTE.
#
# PORTANTO:
# É PERMITIDO, SE NECESSÁRIO, DROPAR/RECRIAR A BASE COMPLETAMENTE
# PARA ALINHÁ-LA À VERSÃO CONSOLIDADA ATUAL.
#
# NÃO É NECESSÁRIO PRESERVAR OS DADOS DE TESTE EXISTENTES.

============================================================
0. OBJETIVO
============================================================

Atualizar integralmente a instância atual do ArkPet no Replit
para a versão consolidada anterior ao PRODUCT REFINEMENT PROGRAM.

O objetivo é terminar com:

- frontend atualizado;
- backend atualizado;
- banco compatível com o schema atual;
- OpenAPI alinhado;
- clients gerados alinhados;
- env/secrets configurados;
- storage configurado;
- Stripe configurado;
- PWA/Push preservados;
- TypeScript com 0 erros;
- build com EXIT 0;
- aplicação iniciando e funcionando no Replit.

============================================================
1. CUT-OFF FUNCIONAL
============================================================

A versão desejada é a BASELINE CONSOLIDADA anterior ao início de:

PRODUCT REFINEMENT PROGRAM.

Portanto:

NÃO implementar fases:

R0
R1
R2
R3A
R3B
R4A
R4B
ou qualquer futura fase R*.

============================================================
2. REGRA DE OURO
============================================================

Esta atividade é de:

- atualização de ambiente;
- alinhamento de código;
- alinhamento de contratos;
- atualização/recriação da base de teste;
- preparação de deploy.

NÃO é:

- novo redesign;
- nova funcionalidade;
- novo módulo;
- nova regra de negócio;
- refatoração arquitetural livre.

============================================================
3. SOBRE O BANCO DE TESTE
============================================================

IMPORTANTE:

A base PostgreSQL atual é de TESTE.

NÃO é necessário preservar:

- usuários;
- pets;
- tutores;
- reservas;
- faturas;
- pedidos;
- transações;
- créditos;
- estoque;
- mídia relacionada ao teste;
- qualquer outro dado existente.

============================================================
4. AUTORIZAÇÃO PARA RESET DE BANCO
============================================================

Se for a forma mais segura e correta de alinhar o ambiente,
ESTÁ AUTORIZADO:

- DROP de tabelas;
- DROP de enums;
- DROP de schema;
- recriação de schema;
- recriação de tabelas;
- recriação de constraints;
- recriação de indexes;
- recriação de enums;
- reset completo da base;
- migrations do zero;
- drizzle-kit push;
- seed de desenvolvimento/teste,
  se existir script oficial e for necessário para uso do sistema.

============================================================
5. MAS NÃO DESTRUIR SEM AUDITAR
============================================================

Antes de dropar/recriar,
primeiro confirmar:

- DATABASE_URL aponta para a base de TESTE correta;
- não é produção;
- não é staging com dados importantes;
- não há outro serviço compartilhando essa base.

Se houver qualquer dúvida:

STOP.

Reportar antes de executar DROP.

============================================================
6. DATABASE TARGET
============================================================

O target final deve ser exatamente o schema atual do repositório.

Fonte principal:

lib/db

Drizzle schema atual.

============================================================
7. DATABASE STRATEGY
============================================================

Executar primeiro:

A. identificar provider e conexão;
B. inspecionar schema atual;
C. comparar com Drizzle atual;
D. decidir entre:
   - migration incremental
   OU
   - full reset;
E. preferir FULL RESET se a base antiga estiver muito divergente,
   já que os dados são descartáveis;
F. recriar base;
G. validar schema final.

============================================================
8. DRIZZLE
============================================================

Detectar os scripts reais existentes para:

- generate;
- migrate;
- push;
- seed.

Usar os scripts oficiais do projeto.

Não inventar fluxo paralelo.

============================================================
9. IF USING DRIZZLE PUSH
============================================================

Se a estratégia correta for:

drizzle-kit push

pode executar,
desde que a conexão tenha sido confirmada como TEST DB.

============================================================
10. SEED
============================================================

Se existir seed oficial de desenvolvimento,
pode executá-lo após recriar o banco.

Mas:

- não inventar dados manualmente;
- não criar novo sistema de seed;
- não criar fixtures complexas;
- usar somente mecanismo já existente.

============================================================
11. BASELINE TÉCNICA ESPERADA
============================================================

A versão consolidada já havia atingido:

npm run typecheck
EXIT 0
0 errors

npx tsc -b
EXIT 0

npm run build
EXIT 0.

Os 9 erros encontrados no Replit representam divergência
da baseline esperada.

============================================================
12. TYPECHECK É OBRIGATÓRIO
============================================================

Não considerar o projeto pronto enquanto existir:

EXIT 2
9 errors

ou qualquer quantidade > 0.

Target:

EXIT 0
0 errors.

============================================================
13. PROIBIDO ESCONDER ERROS
============================================================

NÃO usar:

any

as any

as unknown as

@ts-ignore

@ts-expect-error

non-null assertion arbitrária

fake local interfaces

casts para silenciar contratos.

============================================================
14. SETTINGS — ERROS ATUAIS
============================================================

Erros encontrados:

deliveryFee

deliveryType

pixKey

pixName

não reconhecidos no tipo Creche usado por Settings.

============================================================
15. BASELINE CONSOLIDADA SETTINGS
============================================================

Na baseline correta,
Creche deve refletir:

deliveryType

deliveryFee

pixKey

pixName.

UpdateCrecheRequest também deve refletir os quatro campos.

============================================================
16. DELIVERY CONTRACT
============================================================

deliveryType:

"fixed"
|
"on_demand"

deliveryFee:

string no contrato HTTP consolidado.

============================================================
17. PIX CONTRACT
============================================================

pixKey

pixName

já fazem parte do comportamento consolidado.

============================================================
18. SETTINGS INVESTIGATION
============================================================

Antes de corrigir:

verificar a importação real de Creche em:

src/pages/settings/index.tsx

Comparar com:

- backend;
- OpenAPI;
- generated api schemas;
- generated hooks.

============================================================
19. NÃO ASSUMIR IMPORT ERRADO
============================================================

A hipótese do relatório anterior
de que Settings importa "o tipo errado"
deve ser VERIFICADA.

Não corrigir baseado só em hipótese.

============================================================
20. PETS / WALKS — ERROS ATUAIS
============================================================

Erros atuais mostram divergência entre:

Pet[]

e:

{
  items: Pet[],
  total: number
}

============================================================
21. PETS CONTRACT CONSOLIDADO
============================================================

Na baseline consolidada,
o backend de listPets já havia sido alinhado para retornar:

{
  items,
  total
}

e o OpenAPI/client deveria refletir isso.

============================================================
22. SOURCE OF TRUTH
============================================================

Reconfirmar o backend atual da rota de Pets.

Se o backend retorna:

{
  items,
  total
}

então:

OpenAPI deve refletir exatamente isso.

============================================================
23. OPENAPI
============================================================

Source of truth:

lib/api-spec/openapi.yaml

============================================================
24. ORVAL
============================================================

Generated clients/schemas devem vir de:

Orval.

============================================================
25. GENERATED FILES
============================================================

NUNCA editar manualmente:

lib/api-client-react/src/generated/api.schemas.ts

lib/api-client-react/src/generated/api.ts

lib/api-zod/src/generated/api.ts

ou qualquer arquivo generated equivalente.

============================================================
26. CODEGEN FLOW
============================================================

Se OpenAPI estiver stale:

1. corrigir openapi.yaml;
2. executar npm run codegen;
3. inspecionar diff;
4. confirmar que generated types refletem backend;
5. rodar typecheck.

============================================================
27. WALKS
============================================================

/walks permanece rota redirect na arquitetura consolidada.

NÃO reativar a página.

Mas arquivos inativos ainda precisam compilar.

============================================================
28. EXPECTED WALKS RESULT
============================================================

Após o contrato de Pets estar correto,
os callbacks:

.filter(p => ...)
.map(p => ...)

devem inferir p como Pet,
sem any/casts.

============================================================
29. WALK SCHEDULE
============================================================

Preservar suporte consolidado a:

walkSchedule

quando existente no schema atual.

============================================================
30. BOOKING CONTRACT
============================================================

Preservar contratos já consolidados,
incluindo, se presentes no backend/schema atual:

packageMaxPets

primaryCatalogueItemId

additionalServiceIds.

============================================================
31. CONSUMABLE DELETE
============================================================

Preservar o uso do bookingId real do booking confirmado.

Não reintroduzir versões antigas.

============================================================
32. ROLES
============================================================

Preservar:

tutor

staff

creche_admin

master_admin.

NÃO criar:

super_admin.

============================================================
33. DASHBOARD BRANCHING
============================================================

Preservar:

staff
→ StaffDashboard

master_admin
→ MasterAdminDashboard

tutor
→ TutorDashboard

fallback
→ CrecheDashboard.

============================================================
34. ROUTES
============================================================

Baseline histórica:

29 route declarations

2 redirect-only

27 active visual routes.

Usar código atual como source of truth.

Não mudar rotas para "bater com número".

============================================================
35. WOUTER
============================================================

Router atual:

Wouter.

NÃO instalar/migrar para React Router.

============================================================
36. FRONTEND STACK
============================================================

Preservar:

React

Vite

TypeScript

Tailwind CSS v4

Shadcn/UI

Lucide

TanStack React Query

Wouter.

============================================================
37. BACKEND STACK
============================================================

Preservar:

Express

Drizzle

PostgreSQL

auth atual

storage atual

Stripe atual

push atual.

============================================================
38. FINANCEIRO
============================================================

Preservar integralmente:

Orders

Invoices

Transactions

Expenses

POS

Credits

Wallet

Stock

Cash Flow

Sales Dashboard

Reports existentes.

============================================================
39. MONEY FREEZE
============================================================

NÃO alterar:

centavos

reais

formatters

parsers

invoice totals

order totals

credits

wallet calculations

taxas

descontos.

============================================================
40. NÃO CRIAR DRE
============================================================

DRE continua inexistente.

NÃO criar.

============================================================
41. RECEIPT
============================================================

Preservar comportamento existente.

Se ainda houver debt:

crecheId fallback

apenas reportar.

Não corrigir nesta atividade,
a menos que isso impeça a aplicação de funcionar.

============================================================
42. SETTINGS
============================================================

Preservar:

Delivery

PIX

Push

Theme

LGPD

dados da creche.

============================================================
43. SETTINGS BUSINESS FREEZE
============================================================

Não alterar:

FormData

payload

save behavior

invalidateQueries

permission branches

delivery semantics

PIX semantics.

============================================================
44. COMMUNICATION
============================================================

Preservar:

Chat

Feed

Tutor Timeline

mídia.

============================================================
45. CHAT
============================================================

Rota:

/chat.

============================================================
46. FEED
============================================================

Preservar localização e comportamento atuais
da baseline consolidada.

NÃO implementar refinamentos R*.

============================================================
47. TUTOR TIMELINE
============================================================

Preservar no TutorDashboard.

============================================================
48. MEDIA / STORAGE
============================================================

Preservar Object Storage atual.

Não substituir por filesystem local.

============================================================
49. STORAGE TEST DATA
============================================================

Como esta é base de teste,
NÃO é obrigatório preservar mídia antiga.

Mas o provider/configuração corretos devem continuar funcionando.

============================================================
50. STORAGE VALIDATION
============================================================

Confirmar:

- bucket/provider;
- upload;
- leitura;
- public/private paths;
- env vars.

============================================================
51. STRIPE
============================================================

Preservar integração atual.

Não:

- trocar provider;
- desabilitar webhook;
- ignorar signature;
- criar pagamento fake em produção.

============================================================
52. STRIPE ENVIRONMENT
============================================================

Confirmar se Replit atual usa:

TEST

ou

PRODUCTION.

Não misturar chaves.

============================================================
53. WEBHOOK
============================================================

Endpoint:

POST /api/stripe/webhook

Configurar no Stripe
após domínio de produção definitivo.

============================================================
54. PUSH / PWA
============================================================

Preservar:

service worker

manifest

push

VAPID

installability

safe areas.

============================================================
55. VAPID
============================================================

Como a base é de teste,
se as chaves antigas não existirem,
pode gerar/configurar um par NOVO
somente se o sistema já possuir
mecanismo/documentação normal para isso.

Não criar implementação nova.

============================================================
56. ENV FILES
============================================================

Foram encontrados:

.env

artifacts/api-server/.env

lib/db/.env

versionados.

============================================================
57. REPLIT SECRETS
============================================================

Migrar valores necessários para Replit Secrets.

Nunca imprimir valores sensíveis.

============================================================
58. ENV CLEANUP
============================================================

Após confirmar que todos os valores necessários
estão corretamente disponíveis via Replit Secrets:

é permitido remover os .env versionados
e corrigir .gitignore.

============================================================
59. SECURITY NOTE
============================================================

Se secrets reais foram commitados,
registrar:

ROTATION RECOMMENDED.

Como ambiente é teste,
rotação é aceitável,
desde que não quebre integrações externas
que ainda estejam em uso.

============================================================
60. CRITICAL ENV VARS
============================================================

Confirmar pelo código real:

DATABASE_URL

SESSION_SECRET

JWT_SECRET

ENCRYPTION_KEY

PASSWORD_SALT

APP_URL

FRONTEND_URL

STRIPE_SECRET_KEY

STRIPE_PUBLISHABLE_KEY

STRIPE_WEBHOOK_SECRET

VAPID_PUBLIC_KEY

VAPID_PRIVATE_KEY

VAPID_EMAIL

RESEND_API_KEY

RESEND_FROM_EMAIL

PRIVATE_OBJECT_DIR

PUBLIC_OBJECT_SEARCH_PATHS

DEFAULT_OBJECT_STORAGE_BUCKET_ID

NODE_ENV

PORT

e quaisquer outras realmente usadas.

============================================================
61. DO NOT INVENT ENV NAMES
============================================================

A lista acima é referência do relatório anterior.

Usar o código atual como fonte real.

============================================================
62. APP_URL
============================================================

Configurar para a URL pública correta
do Replit/deploy final.

============================================================
63. FRONTEND_URL
============================================================

Configurar para URL correta
conforme arquitetura final.

============================================================
64. CORS
============================================================

Preservar política segura existente.

Não usar:

origin: "*"

por conveniência
se auth depende de origem controlada.

============================================================
65. AUTH
============================================================

Preservar JWT Bearer atual.

Não migrar para Replit Auth.

============================================================
66. PACKAGE MANAGER
============================================================

Preservar:

pnpm

pnpm-lock.yaml

pnpm-workspace.yaml.

============================================================
67. NÃO CONVERTER
============================================================

Não gerar package-lock
ou migrar para npm
sem necessidade.

============================================================
68. DEPENDENCIES
============================================================

Não atualizar versões
só porque existem versões novas.

============================================================
69. PROIBIDO
============================================================

Não executar:

npm update

pnpm update

audit fix --force

upgrade --latest

sem necessidade real.

============================================================
70. NODE
============================================================

Usar versão compatível
com o repositório atual.

Node 24.13.0 já mostrou compatibilidade
no ambiente auditado.

============================================================
71. RUN CONFIGURATION
============================================================

Scripts identificados:

Frontend:
pnpm --filter @workspace/petdaycare run dev

Backend:
pnpm --filter @workspace/api-server run dev

Preservar se continuam válidos.

============================================================
72. PRODUCTION
============================================================

Backend prod:

node dist/index.cjs

Frontend:

vite build

e static serving pelo backend
conforme implementação existente.

============================================================
73. SPA FALLBACK
============================================================

Garantir acesso direto a rotas Wouter:

/login

/pets/...

/settings

/financial

/chat

etc.

sem 404 de hosting.

============================================================
74. DATABASE RESET PLAN
============================================================

Se optar por full reset:

1. confirmar TEST DATABASE;
2. parar serviços que gravem durante reset;
3. dropar schema/tabelas conforme método oficial;
4. recriar schema;
5. aplicar Drizzle schema atual;
6. rodar seed oficial, se necessário;
7. iniciar backend;
8. verificar logs;
9. rodar smoke test.

============================================================
75. DATABASE VALIDATION
============================================================

Depois do reset,
confirmar schema atual em áreas como:

creches

users

staff

tutors

pets

bookings

tasks

catalogue

stock

orders

invoices

transactions

expenses

credits

subscriptions

notifications

chat

media

e demais tabelas reais.

============================================================
76. CRECHE FIELDS
============================================================

Confirmar na base final:

deliveryType

deliveryFee

pixKey

pixName.

============================================================
77. PETS
============================================================

Confirmar schema atual
compatível com backend e OpenAPI.

============================================================
78. BACKEND/OPENAPI RULE
============================================================

Sempre seguir:

backend reality

→ openapi.yaml

→ Orval codegen

→ generated clients

→ frontend consumer.

============================================================
79. NEVER REVERSE CONTRACT FLOW
============================================================

Não alterar generated client
para "forçar"
compatibilidade com página.

============================================================
80. CODEGEN
============================================================

Se necessário,
executar o comando oficial.

Depois:

git diff

typecheck

build.

============================================================
81. TYPECHECK FINAL
============================================================

Executar:

npm run typecheck

no workspace correto.

TARGET:

EXIT 0
0 errors.

============================================================
82. TSC-B FINAL
============================================================

Executar:

npx tsc -b

TARGET:

EXIT 0.

============================================================
83. BUILD FINAL
============================================================

Executar:

npm run build

Aguardar terminar.

TARGET:

EXIT 0.

============================================================
84. BUILD NÃO SUBSTITUI TYPECHECK
============================================================

Vite build EXIT 0
não compensa TypeScript > 0.

Ambos precisam passar.

============================================================
85. STARTUP
============================================================

Iniciar:

backend

frontend

com os scripts oficiais.

============================================================
86. SMOKE TEST
============================================================

Como a base é de teste,
é permitido criar/usar dados de teste
para validar fluxos básicos.

============================================================
87. SMOKE TEST MÍNIMO
============================================================

Validar:

- login;
- dashboard;
- criação/leitura de creche se aplicável;
- pets;
- tutores;
- reservas;
- Staff Board;
- Feed/Timeline;
- financeiro;
- Store;
- Settings;
- API;
- storage;
- rotas client-side.

============================================================
88. NÃO FAZER PAGAMENTO REAL
============================================================

Não executar cobrança real.

Use apenas ambiente Stripe de teste,
se testado.

============================================================
89. PRODUCT REFINEMENT FREEZE
============================================================

NÃO aplicar:

R3B status refinements

R4 filters refinements

ou qualquer Product Refinement posterior.

============================================================
90. DESIGN FREEZE
============================================================

Não alterar:

layout

tema

cores

cards

filtros

badges

modais

tabs

navigation

spacing

UX

como parte desta tarefa.

============================================================
91. ALLOWED CODE CHANGES
============================================================

Permitido somente o necessário para:

- restaurar baseline consolidada;
- alinhar contratos;
- corrigir typecheck regressions;
- configurar Replit;
- configurar DB de teste;
- configurar env;
- configurar storage;
- configurar deploy.

============================================================
92. NO NEW FEATURES
============================================================

0 novas funcionalidades.

============================================================
93. NO BUSINESS CHANGE
============================================================

0 mudanças intencionais
de regra de negócio.

============================================================
94. GIT SAFETY
============================================================

Antes:

git status

git branch --show-current

git log -1 --oneline.

============================================================
95. NÃO USAR GIT DESTRUTIVO
============================================================

Mesmo podendo resetar o banco,
NÃO usar:

git reset --hard

git clean -fd

force push

sem autorização.

Banco de teste descartável
não significa código descartável.

============================================================
96. EXISTING LATER-PHASE DIFF
============================================================

Se existirem mudanças R*
já presentes no código:

NÃO removê-las automaticamente.

Identificar e reportar.

Aguardar decisão humana
antes de rollback de código.

============================================================
97. FINAL ERROR MATRIX
============================================================

Registrar:

BEFORE:
9 TypeScript errors.

AFTER:
target 0.

Separar:

Settings errors

Pets/Walks errors

new errors if any.

============================================================
98. FINAL DATABASE REPORT
============================================================

Informar:

- estratégia escolhida:
  incremental ou full reset;
- confirmação de TEST DB;
- schema recriado?;
- migrations/push executados?;
- seed executado?;
- erros?;
- resultado final.

============================================================
99. FINAL ENV REPORT
============================================================

Para cada env necessária:

NAME

PRESENT?

REPLIT SECRET?

CONFIG?

BLOCKING?

VALUE:
NUNCA MOSTRAR.

============================================================
100. FINAL STORAGE REPORT
============================================================

Confirmar:

provider

bucket/path

upload test

read test

filesystem fallback:
NO.

============================================================
101. FINAL STRIPE REPORT
============================================================

Confirmar:

mode test/prod

secret present

publishable key present

webhook secret present

webhook endpoint

external config pending.

============================================================
102. FINAL PWA/PUSH REPORT
============================================================

Confirmar:

manifest

service worker

VAPID

HTTPS

push status.

============================================================
103. FINAL CODE REPORT
============================================================

Para cada arquivo alterado:

FILE

WHY

BASELINE ALIGNMENT?

REPLIT CONFIG?

BUSINESS CHANGE?

============================================================
104. SUCCESS CRITERIA
============================================================

Considerar pronto somente se:

✓ Test DB corretamente identificada

✓ schema alinhado à versão atual

✓ DB recriado/migrado sem erro

✓ backend inicia

✓ frontend inicia

✓ API responde

✓ storage responde

✓ login funciona

✓ Settings compila

✓ Pets contract compila

✓ walks legacy compila

✓ TypeScript EXIT 0

✓ 0 TypeScript errors

✓ tsc-b EXIT 0

✓ build EXIT 0

✓ SPA routes funcionam

✓ env/secrets configurados

✓ nenhuma feature nova criada

✓ nenhum Product Refinement aplicado.

============================================================
105. FINAL VERDICT
============================================================

Escolher:

ARKPET REPLIT
FULLY ALIGNED / READY

ARKPET REPLIT
READY WITH EXTERNAL CONFIGURATION PENDING

ARKPET REPLIT
BLOCKED.

============================================================
106. EXTERNAL CONFIGURATION
============================================================

Pode permanecer pendente apenas
o que depende de serviço externo,
como:

DNS

domínio final

Stripe webhook dashboard

chaves que só o proprietário possui.

Separar isso de erro de aplicação.

============================================================
107. FINAL QUESTIONNAIRE
============================================================

1. Confirmed TEST database?

2. Existing test data preservation required?
Expected NO.

3. Full DB reset required?

4. Full DB reset executed?

5. Schema recreated successfully?

6. Drizzle schema fully applied?

7. Seed required?

8. Seed executed?

9. deliveryType present?

10. deliveryFee present?

11. pixKey present?

12. pixName present?

13. Backend listPets real response?

14. OpenAPI matches listPets?

15. Codegen required?

16. Codegen executed?

17. Generated files manually edited?
Expected NO.

18. Settings TS errors remaining?

19. Walks/Pets TS errors remaining?

20. Total TypeScript errors?

21. Typecheck exit?

22. Target 0 reached?

23. tsc-b exit?

24. Build exit?

25. Backend starts?

26. Frontend starts?

27. API reachable?

28. Login works?

29. Pets work?

30. Tutors work?

31. Bookings work?

32. Staff works?

33. Feed/Timeline work?

34. Finance works?

35. Store works?

36. Settings works?

37. Storage works?

38. VAPID configured?

39. Stripe mode confirmed?

40. Stripe webhook external config pending?

41. Env committed files handled?

42. Replit Secrets configured?

43. Product Refinement implemented?
Expected NO.

44. New features created?
Expected NO.

45. Business semantics changed?
Expected NO.

46. UI redesigned?
Expected NO.

47. Files modified?

48. Remaining blockers?

49. Final verdict?

============================================================
108. REPORT FORMAT
============================================================

Entregar:

A. TEST ENVIRONMENT CONFIRMATION

B. REPOSITORY STATUS

C. DATABASE STRATEGY

D. DATABASE RESET / MIGRATION

E. FINAL DATABASE SCHEMA

F. CODE BASELINE RECONCILIATION

G. SETTINGS CONTRACT

H. PETS CONTRACT

I. OPENAPI / CODEGEN

J. ENV / REPLIT SECRETS

K. STORAGE

L. AUTH

M. PUSH / PWA

N. STRIPE

O. TYPECHECK

P. TSC-B

Q. BUILD

R. BACKEND START

S. FRONTEND START

T. SMOKE TEST

U. FILE CHANGES

V. EXTERNAL CONFIG PENDING

W. FINAL VERDICT.

============================================================
109. STOP CONDITIONS
============================================================

STOP somente se:

- DATABASE_URL não puder ser confirmada como TEST;
- reset puder afetar produção;
- backend/OpenAPI target estiver ambíguo;
- codegen gerar drift inesperado;
- configuração externa necessária não estiver disponível;
- correção exigir mudança de regra de negócio.

============================================================
110. FINAL PRINCIPLE
============================================================

A base de TESTE pode ser apagada.

O CÓDIGO e a REGRA DE NEGÓCIO não.

Objetivo final:

REPLIT rodando a versão consolidada correta do ArkPet,
com banco recriado se necessário,
0 erros TypeScript
e sem Product Refinement posterior.

============================================================
111. EXECUTE
============================================================

Executar de forma controlada,
documentar cada mudança
e entregar relatório final.

NÃO iniciar nenhuma fase R*
ao terminar.
