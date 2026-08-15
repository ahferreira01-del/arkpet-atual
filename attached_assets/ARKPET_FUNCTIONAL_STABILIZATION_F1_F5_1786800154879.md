# ARKPET — FUNCTIONAL STABILIZATION PROGRAM

# FASES F1 → F5
# CORREÇÃO DOS 6 BUGS COM CAUSA RAIZ COMPROVADA

# BASE:
# F0 ROOT CAUSE AUDIT — APPROVED / FROZEN

============================================================
0. OBJETIVO
============================================================

Corrigir os seis problemas funcionais comprovados na auditoria F0:

F0-001 — Fatura avulsa vence no dia do pedido.
F0-002 — Chat não abre diretamente nas últimas mensagens.
F0-003 — Pet já checked-in não consegue iniciar serviço de banho.
F0-004 — Push notifications não funcionam.
F0-005 — Alguns vídeos falham no upload.
F0-006 — Fotos adicionadas em tarefas no iOS não aparecem corretamente no Feed.

============================================================
1. BASELINE OBRIGATÓRIA
============================================================

Antes de qualquer patch:

git status
npm run typecheck
npx tsc -b
npm run build

Esperado:

TypeScript: EXIT 0 / 0 errors
tsc -b: EXIT 0
build: EXIT 0

============================================================
2. PRODUCT REFINEMENT FREEZE
============================================================

NÃO implementar nenhuma fase R*.

NÃO alterar design, layout, cards, filtros, badges, spacing, tema, navegação ou UX geral.

Esta iniciativa é exclusivamente FUNCTIONAL BUGFIX.

============================================================
3. REGRA PRINCIPAL
============================================================

Não usar refactor amplo.
Não corrigir coisas adjacentes “aproveitando o arquivo”.
Cada patch deve atacar somente a causa raiz comprovada.

============================================================
4. PROIBIDO
============================================================

NÃO usar:
- any
- as any
- as unknown as
- @ts-ignore
- @ts-expect-error
- casts artificiais
- novos status
- novos endpoints
- novas regras de negócio
- novas configurações de produto
- novos módulos

============================================================
5. EXECUÇÃO SEQUENCIAL
============================================================

Executar nesta ordem:

F1 — Push / VAPID
F2 — Invoice Due Date
F3 — Check-in + Service
F4 — Media Pipeline
F5 — Chat Initial Scroll

Após CADA fase:
1. inspecionar diff;
2. validar comportamento;
3. executar typecheck;
4. interromper se houver regressão.

Se uma fase falhar: STOP. Não iniciar a seguinte.

################################################################
# F1 — PUSH NOTIFICATIONS
################################################################

============================================================
F1.1 ROOT CAUSE
============================================================

Causa comprovada:
VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY pertencem a keypairs diferentes.
Resultado: push service rejeita envio.

============================================================
F1.2 ESTRATÉGIA
============================================================

Esta fase deve ser CONFIG-ONLY sempre que possível.

Preservar a VAPID_PRIVATE_KEY atualmente existente.
Derivar criptograficamente a VAPID_PUBLIC_KEY correspondente à private key existente.
Não gerar novo pair sem necessidade.

Depois de configurar, verificar novamente:
KEYPAIR MATCH: YES.
Não exibir valores das keys.

============================================================
F1.3 DATABASE / RESUBSCRIBE
============================================================

Como é ambiente de teste:
- apagar subscriptions push antigas da tabela push_subscriptions ou equivalente;
- não apagar usuários;
- reiniciar backend;
- confirmar [push] VAPID configured;
- confirmar /api/push/vapid-public-key retornando a public key correta;
- criar nova subscription pelo frontend/PWA atual;
- confirmar novo registro no banco.

============================================================
F1.4 DELIVERY TEST
============================================================

Disparar uma notificação real de teste através do sistema existente.
Registrar resposta do push provider.

Sucesso ideal:
- push provider aceita envio;
- notificação chega ao dispositivo/browser.

Se não houver browser/device capaz de receber:
registrar SERVER DELIVERY VALIDATED / DEVICE RECEIPT PENDING.
Não afirmar “notifications fixed end-to-end” sem entrega real.

Expected: 0 source code changes.

F1 pode congelar quando:
- KEYPAIR MATCH = YES;
- stale subscriptions removidas;
- nova subscription criada;
- backend envia sem erro;
- nenhuma regressão encontrada.

################################################################
# F2 — INVOICE DUE DATE
################################################################

============================================================
F2.1 ROOT CAUSE
============================================================

Faturas avulsas atualmente usam dueDate = itemDateStr, onde itemDateStr = getBusinessDate(), logo dueDate = hoje.

============================================================
F2.2 DECISÃO DE NEGÓCIO
============================================================

REGRA OFICIAL PARA ESTE PATCH:
Faturas avulsas originadas de Orders/POS devem utilizar o PRÓXIMO VENCIMENTO VÁLIDO do ciclo financeiro já existente do tutor.

NÃO criar:
- +7 dias
- +15 dias
- +30 dias
- paymentTermDays
- gracePeriod
- nova configuração por creche

Reutilizar a lógica já existente:
getTutorMensalidadeDia() + getCycleDates(), ou helpers equivalentes atuais.

============================================================
F2.3 REGRAS
============================================================

O dueDate calculado NÃO pode ser anterior à data do item/pedido.

Exemplo conceitual:
- vencimento do tutor dia 10;
- pedido dia 05 → próximo vencimento válido do ciclo;
- pedido dia 15 → próximo vencimento válido, não dia 15.

Não implementar manualmente essa matemática se getCycleDates já resolve.
Se getTutorMensalidadeDia() possui fallback atual, preservá-lo.

============================================================
F2.4 ESCOPO
============================================================

Modificar somente o caminho avulso responsável por dueDate: itemDateStr em services/billing.ts ou localização atual equivalente.

Não alterar:
- isAvulso semantics
- order creation
- order totals
- items
- payment status
- faturas mensais
- paidAt
- transaction
- payment method
- Stripe
- PIX
- timezone America/Sao_Paulo
- getBusinessDate()

============================================================
F2.5 TEST CASES
============================================================

Testar com base de teste:
A. pedido antes do dia de vencimento;
B. pedido no dia do vencimento;
C. pedido depois do dia de vencimento;
D. virada de mês;
E. virada de ano.

Registrar:
- order date
- monthly due day
- calculated dueDate
- invoice status

Nova invoice não deve nascer como overdue simplesmente porque foi criada naquele dia.
Não corrigir mudando a regra de overdue; corrigir o dueDate.

F2 freeze:
- Typecheck EXIT 0
- Tests PASS
- invoice due date correto

################################################################
# F3 — CHECK-IN + SERVICE
################################################################

============================================================
F3.1 ROOT CAUSE
============================================================

POST /:bookingId/checkin possui guard que bloqueia qualquer booking do mesmo pet com status = active.

Cenário:
Day Use active + Banho confirmed → iniciar Banho chama /checkin → guard encontra Day Use active → 409.

============================================================
F3.2 EXPECTED BUSINESS BEHAVIOR
============================================================

Um pet fisicamente presente na creche pode realizar um serviço durante sua permanência.

Target:
PRESENCE BOOKING active + SERVICE BOOKING confirmed → SERVICE BOOKING active.

============================================================
F3.3 CRITICAL SAFETY
============================================================

NÃO remover globalmente o guard alreadyActive.
NÃO transformar “qualquer service ignora qualquer active booking”.

Ao encontrar active booking, classificar:
A. booking de presença;
B. service booking.

Usar SERVICE_BOOKING_TYPES ou source of truth já existente.
Não duplicar array local se constante compartilhada já existe.

============================================================
F3.4 ALLOWED CASE
============================================================

Se:
- target booking = service;
- existing active booking = booking de presença compatível;

permitir start do serviço.

Não criar novo physical check-in.
Se pet já está isCheckedIn = true, preservar.
Não fazer checkout → checkin novamente.

Somente service booking confirmed → active.

============================================================
F3.5 BLOCKED CASES
============================================================

Preservar proteção para:
- Day Use active + outro Day Use confirmed;
- outras combinações que representem duplicidade de presença física.

NÃO permitir automaticamente segundo service booking ativo somente porque ambos são services, salvo regra explícita existente.

Não criar novo status.
Não criar /start-service.
Não alterar complete-service nem comportamento de checkout ao terminar serviço.

============================================================
F3.6 TEST MATRIX
============================================================

A. Day Use active + Bath confirmed → Bath start PASS.
B. Day Use active + another Day Use confirmed → continua BLOCKED.
C. No active booking + Bath confirmed → funcionamento anterior permanece.
D. Bath active + second service → não liberar automaticamente.
E. Service completion com Day Use ainda active → pet continua checked-in.

Confirmar que credits, billing e service price não mudaram.

F3 freeze:
- somente guard necessário mudou;
- Typecheck EXIT 0;
- Tests PASS.

################################################################
# F4 — MEDIA PIPELINE
# VIDEO + IOS TASK PHOTO
################################################################

============================================================
F4.1 ROOT CAUSES
============================================================

VIDEO:
file.type === "" → application/octet-stream → validateUpload 415.

IOS PHOTO:
image/heic / image/heif → original file enviado → validateUpload 415.

============================================================
F4.2 PRINCIPLE
============================================================

O arquivo enviado deve possuir bytes, extension e Content-Type coerentes entre si.

============================================================
F4.3 VIDEO — MIME FALLBACK
============================================================

Em uploadFileDirect(), quando file.type for vazio, inferir MIME SOMENTE a partir de extensões já suportadas:

.mp4 → video/mp4
.mov → video/quicktime
.webm → video/webm

Se file.type já contém MIME válido, preservar.
Se file.type vazio e extensão desconhecida, NÃO inventar MIME; manter falha explícita/controlada.

Não implementar transcoding, FFmpeg, H.265 conversion ou HEVC → H.264.
Se video/mp4 faz upload mas não reproduz por codec, registrar separadamente; não faz parte deste patch.

============================================================
F4.4 IOS PHOTO
============================================================

Inspecionar novamente compressImage() e seu retorno real.

Bug atual:
preview usa resultado tratado, mas uploadFileDirect() recebe o original file.

Target:
quando uma imagem for processada/normalizada com sucesso, o MESMO conteúdo normalizado deve ser usado no upload.

Não deixar:
Preview = JPEG/WebP
Upload = HEIC original

Se compressImage() já retorna Blob/File: usar esse resultado.
Se retorna apenas data URL ou formato não diretamente uploadável: realizar a MENOR extensão necessária ao helper existente para produzir Blob/File.

Usar o formato que o pipeline existente já utiliza para compressão.
Não inventar novo formato.

============================================================
F4.5 MIME INTEGRITY
============================================================

Se bytes são JPEG:
- Content-Type = image/jpeg;
- filename/extensão compatível.

Se output é WebP:
- Content-Type = image/webp;
- extensão correspondente.

Não liberar automaticamente HEIC raw no backend apenas adicionando image/heic/image/heif ao ALLOWED.

Se normalização não puder ser feita com a infraestrutura existente: STOP e reportar alternativas.

============================================================
F4.6 TASK PHOTO / FEED
============================================================

Depois do upload normalizado:
- confirmar mediaDataRef.current recebe URL correta;
- confirmar addEventMutation recebe mediaUrl e tipo correto;
- não alterar completeTaskMutation, status da tarefa ou business logic.

============================================================
F4.7 TEST IMAGES
============================================================

Testar, se arquivos disponíveis:
- JPEG
- PNG
- WebP
- HEIC/HEIF do iOS

Expected:
- JPEG PASS
- PNG PASS
- WebP PASS
- HEIC/HEIF normalizado + upload PASS

============================================================
F4.8 TEST VIDEO
============================================================

Testar:
- MP4 com MIME correto
- MOV com MIME correto
- MP4 file.type vazio
- MOV file.type vazio
- WEBM file.type vazio

Extensões conhecidas com MIME vazio não devem virar application/octet-stream.

Preservar limites atuais de upload (imagem 10MB, vídeo 100MB ou valores reais atuais).
Não aumentar limite.

Confirmar metadata Content-Type correta no Object Storage.

F4 freeze:
- Video MIME fallback PASS
- iOS image normalized PASS
- Feed receives mediaUrl PASS
- Typecheck EXIT 0
- Build EXIT 0

################################################################
# F5 — CHAT INITIAL SCROLL
################################################################

============================================================
F5.1 ROOT CAUSE
============================================================

Atualmente useEffect dependente de allMessages.length executa scrollIntoView({ behavior: "smooth" }) tanto na abertura quanto em mensagens novas.

Primeira abertura: animação ocorre enquanto layout/mídia ainda estão carregando.
Também não há distinção entre initial load e new message.

============================================================
F5.2 TARGET
============================================================

Ao abrir conversa: ir imediatamente para a mensagem mais recente.

No primeiro carregamento, não usar smooth.
Usar auto/instant ou scrollTop = scrollHeight conforme mecanismo mais seguro para o container atual.

Pode usar useRef para registrar se o initial scroll já ocorreu.
Ao trocar de conversa, resetar o estado de initial scroll para a nova thread.

============================================================
F5.3 NEW MESSAGE
============================================================

Depois do initial load:
- nova mensagem só deve fazer smooth auto-scroll se usuário já estiver no bottom ou suficientemente próximo do bottom;
- se usuário rolou para cima para ler histórico, NÃO puxar automaticamente de volta.

Calcular near-bottom usando o scroll container existente.
Não criar arquitetura global de scroll.

============================================================
F5.4 MEDIA LAYOUT SHIFT
============================================================

Na primeira abertura, imagens/mídia podem mudar a altura da lista depois.
Implementar mecanismo mínimo para manter o initial load ancorado no bottom enquanto o conteúdo inicial termina de assumir sua altura.

Pode usar somente o necessário, por exemplo:
- useLayoutEffect
- requestAnimationFrame
- media onLoad callback
- ResizeObserver local

Não criar scroll manager global, context, hook complexo compartilhado ou virtualization.

Preservar messages ASC.
Não alterar message API, React Query, polling, pagination, history loading, send mutation, payload ou attachments.

============================================================
F5.5 TEST MATRIX
============================================================

A. Abrir conversa com muitas mensagens → abrir no fim.
B. Abrir conversa com imagens → continuar no fim depois do layout estabilizar.
C. Receber mensagem estando no bottom → acompanhar.
D. Receber mensagem enquanto usuário lê histórico → não sequestrar scroll.
E. Enviar mensagem estando no bottom → acompanhar.
F. Trocar de conversa → nova conversa abre no fim.

F5 freeze:
- Typecheck EXIT 0
- Build EXIT 0
- Chat query unchanged
- Message order unchanged

################################################################
# GLOBAL VALIDATION
################################################################

============================================================
G1. AFTER ALL PATCHES
============================================================

Executar:
npm run typecheck
TARGET: EXIT 0 / 0 errors

Executar:
npx tsc -b
TARGET: EXIT 0

Executar:
npm run build
TARGET: EXIT 0
Registrar duração.

Reiniciar backend e frontend.
Confirmar ausência de startup/compile/runtime errors.

============================================================
G2. API LOGS
============================================================

Durante smoke tests, monitorar:
- 4xx inesperados
- 500
- SQL errors
- upload 415
- push 401
- push 403
- push 410

============================================================
G3. REGRESSION MATRIX
============================================================

Executar smoke checks para:
- Login
- Dashboard
- Bookings
- Day Use
- Service booking
- Pet check-in
- Pet checkout
- Tasks
- Feed
- Chat
- Invoices
- Orders
- POS
- Store
- Settings
- Push
- Media upload

Confirmar 0 fases R* implementadas e 0 novas funcionalidades.

============================================================
G4. BUSINESS CHANGE MATRIX
============================================================

As únicas mudanças funcionais autorizadas são:
1. fatura avulsa recebe dueDate correto pelo ciclo existente;
2. serviço pode iniciar quando pet já possui presença válida;
3. push volta a usar keypair coerente;
4. media previamente suportada deixa de falhar por MIME/normalização;
5. chat abre na mensagem mais recente.

Nenhuma outra regra deve mudar.

################################################################
# FINAL REPORT
################################################################

============================================================
R1. REPORT STRUCTURE
============================================================

Entregar:

A. PRE-PATCH BASELINE

B. F1 PUSH
- keypair before
- keypair after
- stale subscriptions
- new subscription
- provider response
- device receipt

C. F2 INVOICE
- previous dueDate logic
- new dueDate logic
- helper reused
- test matrix
- invoice statuses

D. F3 CHECK-IN/SERVICE
- guard before
- guard after
- presence/service classification
- test matrix

E. F4 MEDIA
- video MIME fallback
- normalized image pipeline
- HEIC handling
- Object Storage Content-Type
- video test results
- image test results

F. F5 CHAT
- initial scroll before
- initial scroll after
- near-bottom behavior
- media layout handling
- test matrix

G. FILES CHANGED
H. BUSINESS LOGIC DIFF
I. DATABASE CHANGES
J. ENV CHANGES
K. TYPECHECK
L. TSC-B
M. BUILD
N. SMOKE TEST
O. REMAINING LIMITATIONS
P. FINAL VERDICT

============================================================
R2. FILE MATRIX
============================================================

Para cada arquivo alterado:
FILE
PHASE
WHY
FUNCTIONAL CHANGE?
BUSINESS RULE CHANGE?
NEW FEATURE?

Expected:
New feature: NO
Product Refinement: NO
UI redesign: NO
New DB schema: NO expected
OpenAPI: NO expected
Generated files: NO expected

============================================================
R3. FINAL QUESTIONNAIRE
============================================================

1. Push keypair matches?
2. Old subscriptions cleared?
3. New subscription created?
4. Push provider accepts delivery?
5. Notification actually received?
6. Invoice no longer due today by default?
7. Existing billing-cycle helper reused?
8. New payment-term configuration created? Expected NO.
9. Monthly invoice behavior changed? Expected NO.
10. Day Use active + Bath start works?
11. Day Use + Day Use still blocked?
12. Existing physical check-in duplicated? Expected NO.
13. Checkout forced before service? Expected NO.
14. Service completion behavior changed? Expected NO.
15. MP4 empty MIME handled?
16. MOV empty MIME handled?
17. WEBM empty MIME handled?
18. Unknown extensions still rejected safely?
19. HEIC task photo normalized before upload?
20. Raw HEIC stored? Expected NO unless separately approved.
21. Upload Content-Type matches bytes?
22. Task Feed receives mediaUrl?
23. Existing JPEG/PNG/WebP still work?
24. Video transcoding added? Expected NO.
25. Chat opens at latest message?
26. Chat media initial layout stays anchored?
27. New messages auto-scroll near bottom?
28. Reading history is not interrupted?
29. Message query changed? Expected NO.
30. Typecheck exit?
31. TypeScript errors?
32. tsc-b exit?
33. Build exit?
34. Backend starts?
35. Frontend starts?
36. New features? Expected NO.
37. Product Refinement applied? Expected NO.
38. Unexpected regressions?
39. Remaining blockers?
40. Final verdict?

============================================================
R4. FINAL VERDICT OPTIONS
============================================================

Escolher:

FUNCTIONAL STABILIZATION COMPLETE / READY

FUNCTIONAL STABILIZATION PARTIAL — BLOCKERS REMAIN

FUNCTIONAL STABILIZATION BLOCKED

============================================================
R5. STOP
============================================================

Após concluir F1-F5: STOP.

NÃO iniciar:
- R4B
- Product Refinement
- novo redesign
- novas funcionalidades
- refactor arquitetural

Entregar relatório completo e aguardar aprovação.
