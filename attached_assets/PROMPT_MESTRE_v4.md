# PROMPT MESTRE — CORREÇÃO COMPLETA DO SISTEMA

## MISSÃO

Você atuará como Engenheiro de Software Staff, Arquiteto de Software e Especialista em Debugging, Refatoração e Garantia de Qualidade.

Sua missão é realizar uma investigação técnica completa, identificar a causa raiz e corrigir **TODOS** os problemas descritos neste documento, preservando integralmente a arquitetura atual do sistema.

O objetivo **NÃO** é apenas fazer os erros desaparecerem, mas corrigir definitivamente suas causas, garantindo estabilidade, rastreabilidade, qualidade de código e ausência de regressões.

---

## REGRAS GERAIS

É **EXPRESSAMENTE PROIBIDO**:

- Corrigir por tentativa e erro.
- Implementar workarounds ou gambiarras.
- Hardcodar valores ou criar defaults indevidos.
- Duplicar código.
- Ignorar ou esconder exceções.
- Comentar código para "resolver" problemas.
- Remover validações existentes.
- Alterar contratos públicos sem justificativa técnica.
- Criar endpoints desnecessários quando os existentes podem ser corrigidos.
- Alterar regras de negócio não relacionadas aos problemas.
- Alterar arquitetura sem justificativa técnica.

Todas as alterações devem seguir: **Clean Architecture · SOLID · DRY · KISS · baixo acoplamento · alta coesão · tipagem forte · tratamento completo de exceções · logs úteis para diagnóstico**.

---

## METODOLOGIA OBRIGATÓRIA

### Fase 1 — Diagnóstico

Mapear completamente o fluxo antes de alterar qualquer arquivo:

Frontend · Backend · Banco de dados · DTOs · Controllers · Services · Repositories · Mappers · Enums · Endpoints · Storage · Regras de negócio

### Fase 2 — Causa Raiz

Para cada problema documentar:

- O que acontece
- Onde acontece
- Por que acontece
- Arquivos e métodos envolvidos
- Todas as causas identificadas (podem ser múltiplas)

> Nenhuma alteração pode ser iniciada antes de a causa raiz estar completamente identificada.

### Fase 3 — Correção

Corrigir exclusivamente a causa raiz. Eliminar código duplicado relacionado. Consolidar implementações fragmentadas.

### Fase 4 — Validação

Executar testes funcionais completos para cada critério de aceite listado abaixo.

### Fase 5 — Regressão

Executar testes de regressão em todos os módulos relacionados. Somente considerar concluído quando nenhuma regressão for encontrada.

---

## PROBLEMA 01 — FINANCEIRO: Comprovantes não podem ser aprovados

**Problema:** O tutor envia um comprovante de pagamento, o admin visualiza, porém a aprovação não funciona.

**Analisar:**

- Frontend: botão Aprovar · chamada da API · payload enviado · tratamento de erro · atualização de cache · atualização automática da tela
- Backend: endpoint · controller · service · repository · autenticação · autorização · permissões · regras de negócio · transações · logs
- Banco: persistência · campo `status` · `approved_at` · `approved_by` · histórico · auditoria

**Critérios de aceite:**

- ✓ Tutor envia comprovante
- ✓ Admin visualiza o comprovante
- ✓ Admin clica em Aprovar
- ✓ Status atualizado imediatamente
- ✓ Campos `approved_at` e `approved_by` preenchidos no banco
- ✓ Histórico e auditoria preservados
- ✓ Interface atualizada automaticamente (sem reload manual)
- ✓ Tutor visualiza o pagamento como aprovado
- ✓ Nenhum erro no console
- ✓ Nenhuma exceção não tratada

---

## PROBLEMA 02 — Upload de Fotos dos Serviços

**Problema:** Ao cadastrar ou editar um serviço, as fotos não são salvas.

**Analisar:**

- Frontend: seleção · preview · compressão · conversão · upload · envio da URL
- Backend: endpoint · storage · bucket · Content-Type · MIME-Type · autenticação · autorização · geração de URL · persistência
- Banco: URL salva corretamente · relacionamentos íntegros

**Critérios de aceite:**

- ✓ Foto selecionada exibe preview
- ✓ Upload concluído com sucesso
- ✓ Arquivo salvo no storage
- ✓ URL gerada e persistida no banco
- ✓ Foto exibida corretamente após salvar o serviço
- ✓ Nenhuma imagem corrompida
- ✓ Nenhum erro de upload

**Validar obrigatoriamente:** extensão · MIME-Type · Content-Type · tamanho máximo · autenticação · autorização · timeout · comportamento em perda de conexão · retry

---

## PROBLEMA 03 — Upload de Foto ao Finalizar Tarefas

**Problema:** Ao finalizar uma tarefa com foto, o upload falha e impede a conclusão.

**Analisar:**

- Frontend: captura · seleção · compressão · upload · finalização
- Backend: endpoint de upload · armazenamento · associação com a tarefa · persistência

**Fluxo esperado:**

```
Selecionar foto → Upload → URL retornada → Associar à tarefa → Finalizar → Timeline atualizada → Feed atualizado
```

**Critérios de aceite:**

- ✓ Foto selecionada com sucesso
- ✓ Upload realizado
- ✓ URL retornada e associada à tarefa
- ✓ Tarefa finalizada
- ✓ Timeline atualizada
- ✓ Feed atualizado
- ✓ Foto exibida no card do feed

**Em caso de falha no upload:**

- ✓ Mensagem de erro amigável exibida
- ✓ Permitir nova tentativa sem perder os dados preenchidos
- ✓ Tarefa **nunca** finalizada com upload inconsistente

---

## PROBLEMA 04 — Todos os Serviços estão virando Day Use

**Problema:** Independentemente do tipo escolhido (Banho, Táxi, Tosa, Hotel, Consulta, Adestramento…), todos são gravados como Day Use.

**Analisar:** Frontend · DTO · Mapper · Serializer · Controller · Service · Repository · Banco · Enums · Valores padrão · Conversões

**Critérios de aceite:**

| Entrada | Deve ser gravado como |
|---|---|
| Banho | `BANHO` |
| Táxi | `TAXI` |
| Tosa | `TOSA` |
| Hotel / Hospedagem | `HOSPEDAGEM` |
| Consulta | `CONSULTA` |
| Adestramento | `ADESTRAMENTO` |
| Day Use | `DAY_USE` |

- ✓ Jamais utilizar valor fixo ou default que sobrescreva o tipo recebido
- ✓ Nenhum Day Use indevido após a correção

---

## PROBLEMA 05 — Erro ao Aceitar Reservas

**Problema:** Ao tentar aceitar uma reserva ocorre erro e ela permanece pendente.

**Analisar:**

- Frontend: botão Aceitar · loading · payload · atualização da interface
- Backend: endpoint · controller · service · repository · autenticação · autorização · tenant · regras de negócio · conflitos · transações · rollback
- Banco: atualização de status · integridade referencial

**Fluxo esperado:**

```
PENDING → Aceitar → CONFIRMED → Banco atualizado → Agenda atualizada → Interface atualizada → Tutor visualiza alteração
```

**Critérios de aceite:**

- ✓ Reserva muda de `PENDING` para `CONFIRMED`
- ✓ Banco atualizado corretamente
- ✓ Agenda reflete a confirmação
- ✓ Interface atualizada automaticamente
- ✓ Tutor visualiza a reserva confirmada
- ✓ Nenhuma duplicação de registro
- ✓ Nenhuma inconsistência referencial
- ✓ Rollback executado se qualquer operação intermediária falhar

---

## VALIDAÇÃO DA PIPELINE DE MÍDIA (obrigatória para problemas 2 e 3)

Validar em todos os endpoints de upload:

- ✓ MIME-Type correto
- ✓ Content-Type correto
- ✓ Bucket correto (infraestrutura oficial do sistema)
- ✓ Arquivo salvo no storage
- ✓ URL gerada e acessível
- ✓ URL persistida no banco
- ✓ Arquivo recuperável e renderizável no frontend
- ✓ Nenhum erro 401 / 403 / 404 / 500

> Padronizar **todas** as implementações de upload para a infraestrutura oficial do sistema. Eliminar qualquer implementação paralela ou legada.

---

## TESTES DE REGRESSÃO (obrigatórios)

| Módulo | Critérios mínimos |
|---|---|
| Financeiro | Aprovação funciona · histórico íntegro · auditoria preservada |
| Uploads — Serviços | Upload concluído · URL salva · imagem exibida |
| Uploads — Tarefas | Upload concluído · tarefa finalizada · feed atualizado |
| Uploads — Feed / Tutor / Admin | Nenhum upload quebrado em outros fluxos |
| Feed | ≥ 5 cards carregam · imagens aparecem · vídeos reproduzem · 0 erros no console · 0 requisições 4xx/5xx inesperadas |
| Reservas | Criar · aceitar · cancelar · reabrir tela · persistência correta |
| Serviços | Todos os tipos gravados corretamente · nenhum Day Use indevido |
| Banco | Integridade referencial · sem registros órfãos · sem inconsistências |
| API | Nenhum endpoint quebrado · nenhum contrato alterado |
| Interface | Nenhuma tela quebrada · nenhum erro de renderização |
| Logs | Nenhuma exceção não tratada · logs claros · sem erros silenciosos |

---

## QUALIDADE FINAL

Antes de concluir garantir:

- ✓ Frontend React + TypeScript compila sem erros
- ✓ Backend Node.js + TypeScript compila sem erros
- ✓ Nenhum erro de TypeScript
- ✓ Nenhum erro de ESLint
- ✓ Nenhum erro de build
- ✓ Nenhuma Promise rejeitada sem tratamento
- ✓ Nenhuma exceção em runtime
- ✓ Nenhuma migration desnecessária
- ✓ Nenhum endpoint quebrado
- ✓ Nenhum TODO / FIXME criado
- ✓ Nenhum código morto introduzido
- ✓ Nenhuma duplicação introduzida
- ✓ Todas as funcionalidades existentes continuam operando normalmente

---

## RELATÓRIO FINAL OBRIGATÓRIO

Para **cada problema** apresentar:

1. Resumo do problema
2. Causa raiz identificada
3. Fluxo analisado
4. Arquivos modificados
5. Funções / métodos alterados
6. Justificativa técnica de cada alteração
7. Possíveis impactos
8. Testes executados
9. Resultado de cada teste — **PASSOU / FALHOU**
10. Validação de regressão
11. Riscos residuais (se existirem)

> **A tarefa somente poderá ser considerada concluída quando TODOS os cinco problemas estiverem corrigidos, todos os critérios de aceite forem atendidos e nenhuma regressão for identificada.**
