# Onboarding de Creches no ArkPet

## Os 5 Passos Canônicos de Onboarding
Quando uma nova creche é criada, o administrador (`creche_admin`) deve completar os 5 passos canônicos de configuração inicial para colocar a unidade em pleno funcionamento:

1. **Passo 1 — Dados da Creche (`creche_details`):**
   - Rota: `/settings`
   - Critério de Conclusão: Preenchimento de telefone e endereço completo da creche.
   - Objetivo: Estabelecer canais de contato e localização oficial para os tutores.

2. **Passo 2 — Cadastrar Equipe (`staff`):**
   - Rota: `/staff/manage`
   - Critério de Conclusão: Pelo menos 1 funcionário ou colaborador adicional cadastrado (total de membros da equipe > 1).
   - Objetivo: Delegar rotinas diárias e garantir que outros operadores possam utilizar o app.

3. **Passo 3 — Cadastrar Tutor (`tutors`):**
   - Rota: `/tutors`
   - Critério de Conclusão: Cadastro do primeiro tutor de pets (total de tutores > 0).
   - Objetivo: Criar a base de clientes da creche.

4. **Passo 4 — Cadastrar Primeiro Pet (`pets`):**
   - Rota: `/pets`
   - Critério de Conclusão: Cadastro de pelo menos um pet vinculado a um tutor cadastrado (total de pets > 0).
   - Objetivo: Registrar o animal com sua ficha cadastral e restrições.

5. **Passo 5 — Conhecer Reservas (`bookings`):**
   - Rota: `/bookings`
   - Critério de Conclusão: Criação da primeira reserva no sistema (total de reservas > 0).
   - Objetivo: Validar o agendamento de Day Use ou Hospedagem.

## Derivação Canônica
O status do onboarding não é mantido em flags manuais ou JSON paralelo. Ele é calculado dinamicamente com base nos dados reais do banco de dados (existência de registros de staff, tutores, pets e reservas).
