# ARKPET
# REPLIT BOOTSTRAP & DEPLOYMENT ORIENTATION

# BASELINE CONSOLIDADA
# PRÉ-PRODUCT-REFINEMENT

# OBJETIVO:
# SUBIR, CONFIGURAR E VALIDAR A APLICAÇÃO NO REPLIT
# SEM REDESIGN
# SEM NOVAS FUNCIONALIDADES
# SEM REFATORAÇÃO DE NEGÓCIO

============================================================
0. MISSÃO
============================================================

Este repositório contém o ArkPet,
uma plataforma completa de gestão
para creches/hotéis pet.

Sua missão NÃO é desenvolver
novas funcionalidades.

Sua missão é:

1. entender a arquitetura atual;
2. preparar corretamente
   o ambiente no Replit;
3. configurar dependências,
   variáveis e execução;
4. preservar integralmente
   o sistema consolidado;
5. validar TypeScript;
6. validar build;
7. validar frontend/backend;
8. identificar requisitos
   de infraestrutura;
9. deixar a aplicação pronta
   para execução/deploy no Replit;
10. reportar qualquer blocker
    sem inventar soluções destrutivas.

============================================================
1. CUT-OFF OFICIAL
============================================================

A baseline desejada é:

ARKPET CONSOLIDADO
ANTES DO INÍCIO DO:

PRODUCT REFINEMENT PROGRAM.

Portanto:

NÃO implementar nenhuma fase:

R0
R1
R2
R3A
R3B
R4A
R4B
ou qualquer futura fase R*.

============================================================
2. MUITO IMPORTANTE
============================================================

As fases R*
pertencem a um segundo ciclo
de refinamento do produto.

Esse ciclo NÃO faz parte
do bootstrap do Replit.

============================================================
3. SE O REPOSITÓRIO JÁ CONTIVER ALTERAÇÕES POSTERIORES
============================================================

NÃO revertê-las automaticamente.

NÃO usar:

git reset --hard
git checkout .
git restore .
git clean -fd

ou qualquer comando destrutivo.

Primeiro:

- identificar os arquivos;
- identificar o diff;
- separar claramente o que pertence à baseline do que parece posterior;
- reportar.

Aguardar decisão humana antes de qualquer rollback.

============================================================
4. REGRA DE OURO
============================================================

O objetivo desta atividade é:

DEPLOYMENT / ENVIRONMENT READINESS.

Não:

PRODUCT DEVELOPMENT.

============================================================
5. PROIBIDO
============================================================

NÃO:

- criar funcionalidade;
- remover funcionalidade;
- criar nova rota;
- remover rota;
- criar novo módulo;
- trocar framework;
- trocar router;
- trocar ORM;
- trocar banco;
- trocar storage;
- trocar sistema de autenticação;
- alterar regras financeiras;
- alterar reservas;
- alterar permissões;
- alterar status;
- alterar layouts;
- fazer novo redesign;
- reorganizar UX;
- criar novo sistema de filtros;
- refatorar arquitetura sem blocker comprovado.

============================================================
6. NÃO "MELHORAR" O CÓDIGO
============================================================

Não realizar espontaneamente:

cleanup;
modernização;
simplificação;
centralização;
refatoração;
renomeação;
reorganização de diretórios.

============================================================
7. PRINCÍPIO
============================================================

SE ESTÁ FUNCIONANDO
E NÃO IMPEDE O REPLIT:

NÃO TOCAR.

============================================================
8. ARQUITETURA GERAL
============================================================

O ArkPet utiliza uma arquitetura monorepo.

Frontend principal:
artifacts/petdaycare

Backend:
artifacts/api-server

Libraries compartilhadas:
lib/

incluindo contratos OpenAPI,
client React gerado
e schemas gerados.

============================================================
9. FRONTEND
============================================================

Stack consolidada:

React
Vite
TypeScript
Tailwind CSS v4
Shadcn/UI
Lucide
TanStack React Query
Wouter.

============================================================
10. ROUTER
============================================================

IMPORTANTE:

O sistema utiliza WOUTER.

NÃO instalar React Router.
NÃO migrar para React Router.

============================================================
11. BACKEND
============================================================

Preservar exatamente
a implementação existente.

Antes de modificar qualquer coisa,
inspecionar:

package.json
scripts
server entrypoint
API routes
DB configuration
middlewares
auth
environment configuration.

============================================================
12. DATABASE
============================================================

Detectar pelo código atual
qual banco/provider
está realmente configurado.

NÃO assumir um provider diferente.
NÃO converter banco.
NÃO criar banco local como substituto silencioso.

============================================================
13. MIGRATIONS
============================================================

NÃO executar migration destrutiva automaticamente.

Primeiro identificar:

- migration system atual;
- status esperado;
- conexão configurada;
- migrations pendentes.

============================================================
14. DELIVERY
============================================================

A baseline consolidada já possui suporte contratual para:

deliveryType
deliveryFee

deliveryType possui os valores existentes:

fixed
on_demand

============================================================
15. DELIVERY BACKEND
============================================================

A atualização da creche
já deve aceitar e persistir:

deliveryType
deliveryFee

NÃO reconstruir essa implementação.

============================================================
16. PIX
============================================================

A baseline já suporta:

pixKey
pixName

Backend/OpenAPI/generated types
já foram alinhados.

============================================================
17. SETTINGS
============================================================

Preservar integralmente
a tela existente de Settings.

Ela contém, entre outras configurações:

dados da creche;
Delivery;
PIX;
Push;
Theme;
LGPD.

============================================================
18. SETTINGS BUSINESS FREEZE
============================================================

NÃO mudar:

FormData;
payload;
delivery semantics;
PIX semantics;
save behavior;
invalidate behavior;
permission branches.

============================================================
19. ROLES
============================================================

Os papéis existentes são:

tutor
staff
creche_admin
master_admin

============================================================
20. NÃO EXISTE
============================================================

Não criar:

super_admin

============================================================
21. DASHBOARD ROOT
============================================================

Preservar o branching atual do Dashboard.

A lógica conhecida é:

staff
→ StaffDashboard

master_admin
→ MasterAdminDashboard

tutor
→ TutorDashboard

fallback
→ CrecheDashboard

============================================================
22. GUARDS
============================================================

Preservar todos os guards atuais.

Não substituir ou "simplificar" RBAC.

============================================================
23. STAFF OPERATION
============================================================

Rotas operacionais importantes incluem:

/staff/board
/staff/qr-scanner
/staff/manage

============================================================
24. GUARDS OPERACIONAIS
============================================================

Preservar:

/staff/board
→ OperationGuard

/staff/qr-scanner
→ OperationGuard

/staff/manage
→ CrecheAdminGuard

============================================================
25. WALKS
============================================================

/walks é rota de redirect na arquitetura consolidada.

Existe código legado/inativo relacionado a walks.

NÃO reativar somente porque existe arquivo.

============================================================
26. FINANCEIRO
============================================================

O módulo financeiro é altamente sensível.

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
Reports existentes

============================================================
27. NÃO EXISTE DRE
============================================================

Não criar DRE ou contabilidade nova.

============================================================
28. MONEY FREEZE
============================================================

NÃO alterar nenhuma semântica de dinheiro.

Especialmente:

centavos;
reais;
formatters;
parsers;
totais;
descontos;
taxas;
invoice totals;
order totals;
credits.

============================================================
29. MONEY HELPERS
============================================================

Preservar helpers atuais.

Não substituir por conversões improvisadas.

============================================================
30. FINANCIAL ROUTES
============================================================

Preservar proteção atual do módulo financeiro.

Não afrouxar guards para facilitar deploy.

============================================================
31. RECEIPTS
============================================================

Preservar comportamento de impressão existente.

A apresentação white/black de receipt/print
é exceção intencional ao tema geral.

============================================================
32. KNOWN DEBT
============================================================

Se ainda existir fallback histórico
de crecheId em receipt:

NÃO corrigir silenciosamente nesta atividade.

Apenas reportar.

============================================================
33. PETS CONTRACT
============================================================

A baseline já corrigiu drift anterior da API
de listagem de Pets.

O response atual esperado é contratual e tipado.

NÃO voltar para assumption Pet[] puro
caso generated client atual use objeto paginado/estruturado.

============================================================
34. PET LIST
============================================================

Preservar exatamente o consumo atual:

items
total

conforme contrato presente no código.

============================================================
35. PET PAGINATION
============================================================

Pode existir código legacy relacionado a:

page
load more

NÃO limpar durante bootstrap Replit.

============================================================
36. WALK SCHEDULE
============================================================

O OpenAPI consolidado já contempla:

walkSchedule

onde aplicável.

NÃO remover como "campo não usado".

============================================================
37. BOOKING CONTRACT
============================================================

O contrato consolidado
de criação de Booking
já inclui campos existentes
que foram comprovados pelo backend.

Entre eles, quando presentes no schema atual:

packageMaxPets
primaryCatalogueItemId
additionalServiceIds

============================================================
38. NÃO SIMPLIFICAR BOOKING
============================================================

Não remover campos do OpenAPI/client
simplesmente porque uma tela específica não os utiliza.

============================================================
39. CONSUMABLE DELETE
============================================================

A exclusão de consumível de Booking
utiliza bookingId real do booking confirmado.

Preservar.

============================================================
40. COMMUNICATION
============================================================

Preservar:

Chat
Feed
Tutor Timeline
media flow

============================================================
41. CHAT
============================================================

Chat possui rota:

/chat

Não criar nova arquitetura de mensagens.

============================================================
42. FEED
============================================================

Feed permanece integrado ao dashboard
de Creche/Staff conforme implementação atual.

============================================================
43. TUTOR TIMELINE
============================================================

Tutor Timeline permanece no TutorDashboard.

============================================================
44. MEDIA
============================================================

Preservar pipeline atual de:

photos
videos
uploads
object storage

============================================================
45. STORAGE
============================================================

IMPORTANTE PARA REPLIT:

NÃO substituir object storage
por filesystem local temporário
apenas para o deploy funcionar.

============================================================
46. WHY
============================================================

Filesystem do container
não deve virar a nova fonte persistente de mídia
se o sistema já depende de storage externo.

============================================================
47. MEDIA ENVIRONMENT
============================================================

Identificar no código todas as variáveis relacionadas a:

object storage;
bucket;
uploads;
public/private URLs;
credentials.

============================================================
48. STRIPE / PAYMENTS
============================================================

Se integração Stripe continua presente,
preservar integralmente.

============================================================
49. PAYMENT SAFETY
============================================================

NÃO:

trocar Stripe config;
desabilitar webhook;
ignorar signature;
alterar payment method;
alterar PIX/card behavior;
criar fake payment path em produção.

============================================================
50. WEBHOOK
============================================================

Identificar:

endpoint atual;
secret necessário;
URL pública necessária.

Somente documentar/configurar.

============================================================
51. PUSH / PWA
============================================================

Preservar infraestrutura PWA existente.

============================================================
52. NÃO REMOVER
============================================================

Não remover:

manifest;
service worker;
push logic;
installability;
safe-area handling

para simplificar Replit.

============================================================
53. HTTPS
============================================================

Se push/service worker dependem de HTTPS,
considerar isso na validação de deployment.

Não alterar aplicação para contornar HTTPS.

============================================================
54. DESIGN SYSTEM
============================================================

A identidade visual já foi consolidada.

NÃO redesenhar.

============================================================
55. DARK/LIGHT
============================================================

A aplicação possui:

Dark
Light

Dark continua como experiência principal/default.

============================================================
56. THEME
============================================================

Preservar o mecanismo já existente de persistência.

Não trocar ThemeProvider ou storage sem blocker real.

============================================================
57. DARK PALETTE
============================================================

NÃO alterar a paleta Dark consolidada.

============================================================
58. PRIMARY
============================================================

Preservar o verde ArkPet como primary/accent.

============================================================
59. SEMANTIC TOKENS
============================================================

Preservar:

background
foreground
card
primary
secondary
muted
border
success
warning
destructive
e tokens atuais.

============================================================
60. MOBILE FIRST
============================================================

A aplicação é mobile-first.

Preservar:

bottom navigation;
safe areas;
responsive structure;
mobile sheets/dialogs;
input sizes.

============================================================
61. DO NOT DESKTOP-IZE
============================================================

Não adaptar a arquitetura para Replit
de forma que destrua a experiência mobile/PWA.

============================================================
62. ACTIVE ROUTE BASELINE
============================================================

A arquitetura consolidada possui aproximadamente:

29 route declarations
2 redirect-only
27 active visual routes

============================================================
63. IMPORTANT
============================================================

Usar o código atual como fonte de verdade.

Se contagem divergir:

REPORTAR.

Não modificar para "bater com 27".

============================================================
64. GLOBAL IMPLEMENTATION COVERAGE
============================================================

O redesign anterior já cobriu:

active routes
root dashboards
important modals

Não iniciar novo redesign durante deployment.

============================================================
65. TYPESCRIPT INITIATIVE
============================================================

A baseline consolidada encerrou uma dívida
de TypeScript que chegou a 22 errors.

Estado esperado:

0 TypeScript errors.

============================================================
66. ZERO ERROR BASELINE
============================================================

A partir desta baseline:

qualquer erro TypeScript
deve ser tratado como divergência/blocker.

============================================================
67. PROIBIDO
============================================================

Não "resolver" typecheck com:

any
as any
as unknown as
@ts-ignore
@ts-expect-error
non-null assertion sem prova.

============================================================
68. OPENAPI
============================================================

Source of truth:

lib/api-spec/openapi.yaml

============================================================
69. CODEGEN
============================================================

Client/schema generation:

Orval

============================================================
70. GENERATED FILES
============================================================

NÃO editar manualmente arquivos gerados.

============================================================
71. GENERATED LOCATIONS
============================================================

Identificar e preservar os generated files atuais,
incluindo áreas como:

lib/api-client-react/src/generated
lib/api-zod/src/generated

============================================================
72. CODEGEN POLICY
============================================================

NÃO executar codegen automaticamente
apenas por entrar no Replit.

============================================================
73. CODEGEN WHEN REQUIRED
============================================================

Se houver motivo real para regenerar:

1. identificar source OpenAPI;
2. registrar motivo;
3. executar comando oficial;
4. verificar diff;
5. confirmar ausência de drift inesperado.

============================================================
74. PACKAGE MANAGER
============================================================

Detectar no repositório:

packageManager;
lockfile;
workspaces.

============================================================
75. PRESERVE PACKAGE MANAGER
============================================================

Se o projeto usa PNPM:

NÃO converter para npm lockfile.
NÃO gerar package-lock sem necessidade.

============================================================
76. DEPENDENCIES
============================================================

Não atualizar versões durante bootstrap.

============================================================
77. PROIBIDO
============================================================

Não executar:

npm update
pnpm update
latest
upgrade
audit fix --force

============================================================
78. INSTALL
============================================================

Usar instalação compatível
com o lockfile e workspaces existentes.

============================================================
79. NO DEPENDENCY CHURN
============================================================

A instalação não deve resultar
em centenas de alterações de lockfile.

============================================================
80. FIRST REPLIT AUDIT
============================================================

Antes de instalar/executar:

mostrar:

pwd
tree estrutural resumida
package.json raiz
workspaces
lockfiles
scripts principais
Node requirement
package manager requirement

============================================================
81. NODE VERSION
============================================================

Detectar versão requerida pelo projeto.

Configurar Replit para uma versão compatível.

============================================================
82. NÃO ALTERAR CÓDIGO
============================================================

Não resolver incompatibilidade de Node
reescrevendo aplicação.

Primeiro tentar ajustar runtime.

============================================================
83. ENVIRONMENT VARIABLES
============================================================

Criar uma matriz READ-ONLY
de todas as env vars realmente utilizadas.

============================================================
84. ENV SEARCH
============================================================

Procurar:

process.env
import.meta.env
env validators
config modules
secret readers

============================================================
85. ENV MATRIX
============================================================

Para cada variável:

NAME
USED BY
FRONTEND/BACKEND
REQUIRED?
PUBLIC/SECRET
PURPOSE
HAS DEFAULT?
BLOCKS STARTUP?

============================================================
86. DO NOT INVENT
============================================================

NÃO criar nomes de env vars.

Usar exatamente os encontrados no código.

============================================================
87. SECRETS
============================================================

Nunca imprimir valor de secret.

============================================================
88. REPLIT SECRETS
============================================================

Informar ao usuário quais variáveis
precisam ser cadastradas em Secrets/Environment.

============================================================
89. IMPORTANT CATEGORIES
============================================================

Verificar especialmente se existem env vars para:

Database
Auth/session
App URL
Frontend API URL
CORS/origins
Stripe
Stripe webhook
Object Storage
Push/VAPID
email/notifications
external integrations

============================================================
90. DATABASE CONNECTION
============================================================

Testar somente conectividade segura.

Não apagar dados.

============================================================
91. PRODUCTION DATA
============================================================

Não executar:

seed
truncate
reset
drop
force migration

em DB existente.

============================================================
92. SEED
============================================================

Só executar seed se:

ambiente explicitamente for development vazio

E

o usuário autorizar.

============================================================
93. FRONTEND API URL
============================================================

Inspecionar como frontend descobre backend.

============================================================
94. LOCALHOST RISK
============================================================

Se houver hardcode de localhost
que impeça Replit deployment:

REPORTAR PRIMEIRO.

============================================================
95. INFRA-ONLY PATCH
============================================================

Caso seja necessário um pequeno ajuste
exclusivamente de infraestrutura para usar env/base URL:

NÃO executar imediatamente.

Apresentar:

arquivo;
linha;
comportamento atual;
problema no Replit;
patch mínimo proposto;
impacto.

Aguardar autorização.

============================================================
96. CORS
============================================================

Inspecionar configuração atual.

Não abrir:

origin: "*"

por conveniência
se aplicação usa auth/cookies.

============================================================
97. AUTH / COOKIES
============================================================

Se autenticação usa cookie/session,
verificar:

secure;
sameSite;
proxy;
domain;
origin

em relação ao deployment HTTPS.

============================================================
98. NÃO ALTERAR AUTH SEM AUTORIZAÇÃO
============================================================

Se configuração impedir login:

diagnosticar.

Não reescrever autenticação.

============================================================
99. RUN COMMAND
============================================================

Identificar scripts existentes
que iniciam:

frontend
backend
ou monorepo

============================================================
100. NÃO INVENTAR SCRIPT
============================================================

Não criar novo start command
antes de confirmar que scripts existentes
são insuficientes.

============================================================
101. REPLIT RUN
============================================================

Definir o comando de Run
usando a arquitetura atual.

============================================================
102. MULTIPLE SERVICES
============================================================

Se frontend/backend precisarem de processos separados:

identificar como o monorepo atual
já os executa.

============================================================
103. NÃO ADICIONAR PROCESS MANAGER
============================================================

Não instalar:

PM2
forever
concurrently
turbo

ou equivalente apenas para Replit
se já existe solução no repositório.

============================================================
104. HOST BINDING
============================================================

Verificar se servidor faz bind compatível
com ambiente containerizado.

============================================================
105. PORT
============================================================

Verificar uso da porta via ambiente.

============================================================
106. IF PORT BLOCKS REPLIT
============================================================

Reportar patch infra mínimo antes de modificar.

============================================================
107. STATIC FRONTEND
============================================================

Descobrir como produção serve o frontend buildado.

============================================================
108. SPA FALLBACK
============================================================

Como Wouter possui rotas client-side,
verificar se deployment mantém SPA fallback.

============================================================
109. IMPORTANT
============================================================

Não permitir que:

/pets/123
/settings
/financial
/chat

etc.

retornem 404 quando acessadas diretamente em produção
por configuração de hosting.

============================================================
110. DO NOT CHANGE ROUTES
============================================================

Corrigir hosting,
não rotas,
caso esse seja o problema.

============================================================
111. BUILD VALIDATION
============================================================

Executar o typecheck oficial do frontend.

Esperado:

EXIT 0
0 errors

============================================================
112. COMMAND SOURCE
============================================================

Usar script real do package.json.

Não inventar comando alternativo
se já existe script.

============================================================
113. MONOREPO TS
============================================================

Executar também o build TypeScript de workspace
se configurado.

Baseline histórica:

npx tsc -b
EXIT 0

============================================================
114. FRONTEND BUILD
============================================================

Executar build real do frontend.

Esperado:

EXIT 0

============================================================
115. IMPORTANT
============================================================

Aguardar comando terminar.

Não dizer "build passed"
se processo ainda estiver em background.

============================================================
116. WARNINGS
============================================================

Separar warning de error.

============================================================
117. SOURCEMAPS
============================================================

Warnings benignos não devem ser transformados
em refactor espontâneo.

============================================================
118. NO AUTO-FIX
============================================================

Se build passa com warning:

reportar.

Não alterar componentes de biblioteca
para silenciar warning.

============================================================
119. BACKEND START
============================================================

Iniciar backend com script oficial.

============================================================
120. FRONTEND START
============================================================

Iniciar frontend com script oficial
ou build serving conforme arquitetura existente.

============================================================
121. BASIC HEALTH
============================================================

Quando ambiente estiver ativo,
verificar somente smoke checks não destrutivos.

============================================================
122. MINIMUM SMOKE CHECK
============================================================

Validar:

frontend responde;
backend responde;
app shell carrega;
assets carregam;
API base é alcançável;
login page abre;
rotas client-side não quebram hosting.

============================================================
123. NÃO FAZER QA COMPLETO
============================================================

Este prompt NÃO substitui
o Runtime QA posterior.

============================================================
124. NO PRODUCT REFINEMENT
============================================================

Não revisar:

UX
spacing
badges
filters
statuses
cards
modals
layouts

como parte desta atividade.

============================================================
125. IF SOMETHING LOOKS UGLY
============================================================

NÃO corrigir.

Deployment não é redesign.

============================================================
126. REPLIT SPECIFIC FILES
============================================================

Se Replit exigir arquivo/configuração própria:

inspecionar primeiro o que já existe.

============================================================
127. MINIMAL INFRA CHANGE
============================================================

Qualquer arquivo específico de deployment deve:

- ser mínimo;
- não alterar business logic;
- não alterar app architecture;
- ser explicado no relatório.

============================================================
128. NO REPLIT VENDOR LOCK-IN
============================================================

Não reescrever a aplicação
para usar serviços proprietários do Replit
se já existem providers funcionais externos.

============================================================
129. DATABASE
============================================================

Não migrar DB para provider do Replit
somente por conveniência.

============================================================
130. STORAGE
============================================================

Não migrar storage para Replit
somente por conveniência.

============================================================
131. AUTH
============================================================

Não migrar auth para Replit Auth
se o ArkPet já possui autenticação própria.

============================================================
132. PAYMENTS
============================================================

Não substituir Stripe.

============================================================
133. SOURCE OF TRUTH
============================================================

Sempre preferir:

código atual
schemas
OpenAPI
package scripts

ao invés de assumptions.

============================================================
134. NO MEMORY-BASED REWRITE
============================================================

Este documento descreve a baseline esperada,
mas o código enviado é a fonte operacional real.

============================================================
135. IF CONTRADICTION
============================================================

Se código e documento divergirem:

NÃO escolher arbitrariamente.

Reportar:

EXPECTED
FOUND
FILES
IMPACT
RECOMMENDATION

============================================================
136. CRITICAL CONTRADICTIONS
============================================================

Exemplos:

role diferente;
route removida;
OpenAPI stale;
typecheck > 0;
build failure;
missing DB field;
missing generated client;
payment contract drift.

============================================================
137. DO NOT PATCH CRITICAL DRIFT
============================================================

Parar antes de grandes correções.

============================================================
138. GIT SAFETY
============================================================

Antes de trabalhar:

git status
git branch --show-current
git log -1 --oneline

se Git estiver disponível.

============================================================
139. NEVER
============================================================

Não:

force push
reset --hard
clean -fd
rewrite history

============================================================
140. GENERATED FILE SAFETY
============================================================

Não editar generated files manualmente.

============================================================
141. LOCKFILE SAFETY
============================================================

Não substituir lockfile.

============================================================
142. FINAL GOAL
============================================================

O projeto deve chegar ao ponto em que:

DEPENDENCIES
✓

ENV MATRIX
✓

REPLIT RUNTIME
✓

FRONTEND START
✓

BACKEND START
✓

API CONNECTIVITY
✓

TYPECHECK
EXIT 0

TSC BUILD
EXIT 0

FRONTEND BUILD
EXIT 0

SEM BUSINESS CHANGE

SEM PRODUCT REFINEMENT.

============================================================
143. FINAL REPORT
============================================================

Entregar:

A. REPOSITORY STRUCTURE

B. PACKAGE MANAGER

C. NODE/RUNTIME

D. WORKSPACE STRUCTURE

E. FRONTEND ENTRYPOINT

F. BACKEND ENTRYPOINT

G. RUN SCRIPTS

H. BUILD SCRIPTS

I. ENVIRONMENT VARIABLE MATRIX

J. DATABASE CONFIGURATION

K. STORAGE CONFIGURATION

L. AUTH CONFIGURATION

M. STRIPE/PAYMENT CONFIGURATION

N. PUSH/PWA CONFIGURATION

O. REPLIT RUN CONFIGURATION

P. DEPLOYMENT CONFIGURATION

Q. SPA ROUTING

R. TYPECHECK RESULT

S. TSC-B RESULT

T. BUILD RESULT

U. BACKEND START RESULT

V. FRONTEND START RESULT

W. SMOKE CHECK

X. WARNINGS

Y. BLOCKERS

Z. GIT DIFF

============================================================
144. FILE CHANGE MATRIX
============================================================

Para qualquer arquivo alterado:

FILE
WHY
INFRA OR PRODUCT?
REQUIRED FOR REPLIT?
BUSINESS LOGIC CHANGE?

============================================================
145. EXPECTED
============================================================

Business Logic Change:
NO

Product Feature Change:
NO

Design Change:
NO

============================================================
146. FINAL QUESTIONNAIRE
============================================================

1. Repository detected correctly?
2. Monorepo confirmed?
3. Package manager?
4. Lockfile preserved?
5. Node version compatible?
6. Dependencies installed?
7. Dependency upgrades performed? Expected NO.
8. Frontend entrypoint?
9. Backend entrypoint?
10. Frontend start command?
11. Backend start command?
12. Production build command?
13. Env variables mapped?
14. Missing required secrets?
15. DB provider detected?
16. DB connectivity available?
17. Migration required?
18. Destructive migration run? Expected NO.
19. Object storage provider detected?
20. Local filesystem substituted? Expected NO.
21. Stripe present?
22. Stripe secrets required?
23. Webhook URL required?
24. Push/PWA present?
25. HTTPS dependency noted?
26. Auth/session configured?
27. CORS compatible?
28. Public URL configured?
29. SPA fallback working?
30. Direct Wouter route works?
31. `/login` opens?
32. API reachable?
33. Typecheck exit?
34. TypeScript error count?
35. tsc-b exit?
36. Frontend build exit?
37. Build duration?
38. Backend starts?
39. Frontend starts?
40. Smoke check passes?
41. New feature created? Expected NO.
42. Business logic changed? Expected NO.
43. UI redesigned? Expected NO.
44. API contract changed? Expected NO unless blocker explicitly approved.
45. OpenAPI changed? Expected NO.
46. Generated files manually edited? Expected NO.
47. Database schema changed? Expected NO.
48. Later Product Refinement implemented? Expected NO.
49. Existing later-phase diff found?
50. If found, was it preserved without automatic rollback?
51. Files authored specifically for Replit?
52. Remaining blockers?
53. ArkPet ready to run on Replit?

============================================================
147. VERDICT
============================================================

Escolher:

REPLIT READY

REPLIT READY WITH CONFIGURATION REQUIRED

REPLIT BLOCKED

============================================================
148. IMPORTANT
============================================================

Se estiver bloqueado:

NÃO improvisar.
NÃO trocar arquitetura.
NÃO substituir providers.

Explicar o blocker
e a menor correção possível.

============================================================
149. STOP
============================================================

Quando a aplicação estiver preparada
ou o blocker estiver documentado:

STOP.

NÃO iniciar:

Product Refinement
R3
R4
Reservations refinement
Financial redesign
Feed redesign
new features.

Aguardar aprovação humana.
