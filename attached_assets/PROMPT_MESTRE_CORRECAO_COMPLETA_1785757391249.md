# PROMPT MESTRE --- CORREÇÃO COMPLETA DO SISTEMA

> Cole este prompt em seu agente de IA.

## MISSÃO

Você atuará como Engenheiro de Software Staff, Arquiteto de Software e
Especialista em Debugging, Refatoração e Garantia de Qualidade.

Sua missão é realizar uma investigação técnica completa, identificar a
causa raiz e corrigir TODOS os problemas descritos neste documento,
preservando integralmente a arquitetura atual do sistema.

O objetivo NÃO é apenas fazer os erros desaparecerem, mas corrigir
definitivamente suas causas, garantindo estabilidade, rastreabilidade,
qualidade de código e ausência de regressões.

------------------------------------------------------------------------

# REGRAS GERAIS

-   Não implementar workarounds ou gambiarras.
-   Não alterar regras de negócio sem necessidade.
-   Não criar endpoints novos quando os existentes puderem ser
    corrigidos.
-   Não alterar contratos públicos sem justificativa.
-   Não duplicar código.
-   Não esconder exceções.
-   Não comentar código para "resolver" problemas.
-   Reutilizar componentes, hooks, services, repositories e utilitários
    existentes sempre que possível.
-   Manter Clean Architecture, SOLID, DRY, KISS, baixo acoplamento e
    alta coesão.
-   Preservar compatibilidade de toda a aplicação.

------------------------------------------------------------------------

# METODOLOGIA OBRIGATÓRIA

## Fase 1 -- Diagnóstico

Mapear completamente o fluxo antes de alterar qualquer arquivo:

-   Frontend
-   Backend
-   Banco de dados
-   DTOs
-   Controllers
-   Services
-   Repositories
-   Mappers
-   Enums
-   Endpoints
-   Storage
-   Regras de negócio

## Fase 2 -- Causa Raiz

Para cada problema documentar:

-   O que acontece
-   Onde acontece
-   Por que acontece
-   Arquivos envolvidos
-   Métodos envolvidos
-   Todas as causas identificadas

É proibido corrigir por tentativa e erro.

## Fase 3 -- Correção

Corrigir exclusivamente a causa raiz.

Eliminar código duplicado relacionado.

## Fase 4 -- Validação

Executar testes funcionais completos.

## Fase 5 -- Regressão

Executar testes de regressão em todos os módulos relacionados.

------------------------------------------------------------------------

# PROBLEMAS

## 1. Financeiro

Problema: - Comprovantes enviados pelo tutor não podem ser aprovados.

Validar: - Botão Aprovar - API - Payload - Permissões - Controller -
Service - Repository - Banco - approved_at - approved_by - Histórico -
Auditoria

Critério de aceite:

-   Tutor envia comprovante
-   Admin aprova
-   Status atualizado
-   Banco atualizado
-   Interface atualizada
-   Tutor visualiza pagamento aprovado
-   Nenhum erro no console
-   Nenhuma exceção

------------------------------------------------------------------------

## 2. Upload de Fotos dos Serviços

Problema: As fotos dos serviços não são salvas.

Validar toda a pipeline:

Frontend: - seleção - preview - compressão - upload

Backend: - endpoint - storage - bucket - content-type - mime-type -
autenticação - autorização - geração de URL

Banco: - persistência

Critério:

-   upload concluído
-   URL salva
-   imagem exibida posteriormente

------------------------------------------------------------------------

## 3. Upload ao Finalizar Tarefas

Problema: Ao finalizar tarefas com foto o upload falha.

Garantir:

Selecionar foto

↓

Upload

↓

URL

↓

Associar à tarefa

↓

Finalizar

↓

Timeline

↓

Feed

Caso falhe:

-   mensagem amigável
-   retry
-   preservar dados

------------------------------------------------------------------------

## 4. Serviços virando Day Use

Encontrar exatamente onde o tipo é sobrescrito.

Analisar:

Frontend DTO Controller Service Repository Banco Enums Valores padrão

Critério:

Banho → BANHO

Táxi → TAXI

Tosa → TOSA

Hospedagem → HOSPEDAGEM

Consulta → CONSULTA

Adestramento → ADESTRAMENTO

Day Use → DAY_USE

Jamais utilizar valor fixo.

------------------------------------------------------------------------

## 5. Aceitar Reservas

Problema:

Erro ao aceitar reservas.

Validar:

Frontend

Backend

Banco

Permissões

Transações

Critério:

PENDING

↓

CONFIRMED

↓

Agenda atualizada

↓

Interface atualizada

↓

Tutor visualiza alteração

------------------------------------------------------------------------

# VALIDAÇÃO DA PIPELINE DE MÍDIA

Validar:

-   MIME Type
-   Content-Type
-   Bucket
-   Storage
-   URL
-   Persistência
-   Recuperação
-   Renderização
-   Nenhum erro 401/403/404/500

Padronizar todas as implementações de upload para a infraestrutura
oficial do sistema.

------------------------------------------------------------------------

# TESTES DE REGRESSÃO

Financeiro

Uploads

Feed

Timeline

Reservas

Serviços

Banco

API

Interface

Logs

Critérios:

-   Nenhuma exceção
-   Nenhum erro 4xx/5xx inesperado
-   Nenhuma regressão

------------------------------------------------------------------------

# QUALIDADE FINAL

Garantir:

-   Frontend React + TypeScript compila sem erros.
-   Backend Node.js + TypeScript compila sem erros.
-   Nenhum erro de TypeScript.
-   Nenhum erro de ESLint.
-   Nenhum erro de build.
-   Nenhuma Promise rejeitada.
-   Nenhuma exceção em runtime.
-   Nenhuma migration desnecessária.
-   Nenhum endpoint quebrado.
-   Nenhum TODO/FIXME criado.
-   Nenhum código morto.
-   Nenhuma duplicação.
-   Todas as funcionalidades existentes continuam funcionando.

------------------------------------------------------------------------

# RELATÓRIO FINAL

Para CADA problema apresentar:

1.  Resumo
2.  Causa raiz
3.  Fluxo analisado
4.  Arquivos modificados
5.  Métodos alterados
6.  Justificativa técnica
7.  Impactos
8.  Testes executados
9.  Resultado (PASSOU/FALHOU)
10. Regressão
11. Riscos residuais

A tarefa somente poderá ser considerada concluída quando TODOS os
problemas estiverem corrigidos, todos os critérios de aceite forem
atendidos e nenhuma regressão for identificada.
