# Notificações no ArkPet

## Visão Geral
O sistema de notificações do ArkPet mantém tutores e equipe informados sobre acontecimentos relevantes na creche.

## Tipos de Notificações
- **Notificações Push (Web / PWA):** Enviadas através de Service Workers com chaves VAPID, chegando na tela de bloqueio e barra de status do dispositivo.
- **Alertas Internos (In-App):** Avisos e badges exibidos diretamente no App Shell (ex: sino de notificações, contadores de mensagens não lidas).

## Eventos Notificados
1. **Entrada e Saída (Check-in / Check-out):** Avisa o tutor quando o pet chega à creche ou quando a estadia é finalizada.
2. **Novas Mensagens no Chat:** Notifica o destinatário sobre textos ou fotos enviadas.
3. **Tarefas de Cuidado:** Alertas para funcionários sobre horários de refeição ou medicação de pets em atendimento.
4. **Atualizações de Reservas:** Confirmações, alterações ou cancelamentos de agendamentos.
5. **Avisos Financeiros:** Faturas geradas, lembretes de vencimento e confirmações de pagamento.

## Permissões e Respeito ao Usuário
- O app solicita permissão para notificações push de maneira explícita e contextual, nunca de forma invasiva.
- O usuário pode configurar suas preferências nas configurações do seu perfil.
