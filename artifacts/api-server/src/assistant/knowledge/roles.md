# Papéis e Permissões (RBAC) no ArkPet

## Os Quatro Papéis Canônicos
O ArkPet possui exatamente 4 papéis de usuário com hierarquia e escopo estritos:

1. **`master_admin` (Administrador Global):**
   - Responsável pela gestão da plataforma como um todo.
   - Gerencia a criação, licenciamento e status de todas as creches da rede.
   - Acompanha métricas globais de crescimento, faturamento e saúde do ecossistema.
   - Configura os planos de assinatura disponíveis na plataforma.

2. **`creche_admin` (Administrador da Creche):**
   - Responsável total pela gestão da sua unidade específica.
   - Realiza o onboarding da creche (endereço, telefone, regras operacionais).
   - Gerencia membros da equipe (staff), convidando ou revogando acessos.
   - Acessa o painel financeiro, fluxo de caixa e relatórios da creche.
   - Gerencia cadastros de tutores, pets e reservas.

3. **`staff` (Funcionário / Operacional):**
   - Focado nas operações diárias com os pets na creche.
   - Executa check-in e check-out via leitura de QR Code ou seleção na lista.
   - Registra alimentação, administração de medicações, passeios e incidentes.
   - Interage com os tutores pelo chat e posta mídias na timeline/feed.
   - Não possui acesso aos dados financeiros confidenciais da creche.

4. **`tutor` (Tutor / Cliente):**
   - Acesso exclusivo aos seus próprios animais cadastrados.
   - Solicita e acompanha reservas de hospedagem e creche diurna.
   - Conversa com a creche pelo chat e visualiza fotos/vídeos da rotina do pet.
   - Consulta histórico financeiro próprio (mensalidades e faturas individuais).
   - Nunca tem acesso aos dados operacionais internos ou de outros tutores.
