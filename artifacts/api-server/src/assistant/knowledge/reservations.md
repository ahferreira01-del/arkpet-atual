# Reservas no ArkPet

## Modalidades: Hospedagem vs Day Use
O sistema de reservas do ArkPet gerencia os agendamentos de estadias e atendimentos para pets na creche. Existem duas modalidades principais:

1. **Hospedagem (Hotel):**
   - Modalidade com pernoite.
   - O pet permanece na creche durante noites e dias do período selecionado.
   - Requer data e horário de entrada (check-in) e saída (check-out).
   - Ideal para viagens de tutores e estadias prolongadas.

2. **Day Use (Creche Diurna):**
   - Modalidade sem pernoite.
   - O pet passa o dia na creche para socialização e recreação, retornando para casa no final do dia.
   - Pode ser contratado de forma avulsa ou mediante planos de frequência semanal (ex: 2x ou 3x por semana).

## Status de Reserva
Toda reserva possui um ciclo de vida com os seguintes status:
- **Pendente (`pending`):** Reserva solicitada pelo tutor ou em elaboração pela creche, aguardando aprovação.
- **Confirmada (`confirmed`):** Reserva aprovada pela creche e agendada no calendário.
- **Check-in Realizado (`checked_in`):** O pet já chegou na creche e está sob os cuidados da equipe.
- **Check-out Realizado (`checked_out`):** A estadia foi finalizada e o pet foi entregue ao tutor.
- **Cancelada (`cancelled`):** Reserva cancelada antes do início da estadia.

## Regras Importantes
- Para criar uma reserva, o pet deve estar previamente cadastrado e ativo no sistema.
- A creche pode configurar capacidade máxima de vagas por modalidade para evitar sobrelotação.
- Serviços adicionais (ex: banho, tosa, passeios) podem ser vinculados à reserva.
