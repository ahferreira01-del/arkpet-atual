# Relatório FASE 0 — Auditoria Completa (ArkPet)

A FASE 0 foi concluída sem qualquer alteração no código. Os dados abaixo representam o retrato exato da infraestrutura visual atual do ArkPet e servem de fundação para a transição para Light Mode e refinamento do Design System (Fases 1 e 2).

---

## 0.1 — Stack Real Identificada
- **Framework:** React 19 (`react` via catalog)
- **Bundler:** Vite 7.3.5
- **Router:** `wouter` (v3.3.5)
- **State Management:** `@tanstack/react-query`
- **Styling:** TailwindCSS v4 (`@tailwindcss/vite`)
- **UI Base:** Shadcn (Radix primitives)
- **Icons:** `lucide-react`
- **Animations:** `framer-motion` e `tw-animate-css`

## 0.2 — Arquitetura de Tema Atual
- Baseada puramente em CSS Variables definidas em `:root` no arquivo `src/index.css`.
- O Tailwind v4 as consome via bloco `@theme inline`.
- **Ausência Crítica:** Não existe mapeamento de classes `.light` ou `.dark` atualmente (todo o `:root` é intrinsecamente dark).
- O mapeamento atual utiliza semânticas padrão (`--background`, `--foreground`, `--card`, `--primary`, `--destructive`).

## 0.3 — Hardcoded Colors
Durante a execução de tarefas prévias recentes, uma varredura extirpou dezenas de instâncias de `bg-[#11111a]` e `bg-black/20`. O código atual encontra-se **muito limpo** de hardcodes, com raras exceções:
- **Aceitável:** Cores em helpers de scrollbar (`rgba(255, 255, 255, 0.1)`).
- **Atenção:** Alguns `.glass-button` em `index.css` ainda usam composições mistas.

## 0.4 — Rotas e Telas
Inventariamos 11 diretórios de módulo em `src/pages` e aprox. **25+ arquivos de rotas funcionais**.
- **Admin/Staff:** `/admin`, `/staff`, `/settings`
- **Tutor/Módulos:** `/tutors`, `/tutor`, `/pets`, `/walks`
- **Operação/Comercial:** `/bookings`, `/billing`, `/financial`
- **Compartilhados:** `/chat`, auth (`login`, `register`, `change-password`, `reset-password`, `forgot-password`), `/thermal-receipt`

## 0.5 — Componentes Globais (Shadcn/UI)
Encontrados **18 componentes primitivos** consolidados em `src/components/ui/`:
`accordion`, `advanced-data-table`, `alert-dialog`, `badge`, `button`, `card`, `date-filter-popover`, `dropdown-menu`, `empty-state`, `input`, `label`, `modal`, `table`, `tabs`, `textarea`, `toast`, `toaster`, `tooltip`.

## 0.6 — Inconsistências Geométricas (Dívidas Visuais)
- **Radius de Botões:** `default` usa `rounded-full`, enquanto `sm` e `lg` não assumem pílula.
- **Radius de Superfícies:** `Modal` e `Card` usam os arredondados agressivos, mas `DropdownMenu` e `Popover` ainda possuem aparência "Shadcn default" (cantos secos).
- **Badges:** `success` e `warning` usam fórmulas translúcidas (`bg-color/10`), enquanto `destructive` utiliza cor sólida maciça (o que agride a Especificação Visual).

## 0.7 — Cruzamento com a Especificação Visual Autossuficiente
- O código atual é altamente responsivo com mobile-first real (uso contínuo de wrappers dinâmicos, modais que viram bottom-sheets no celular, etc.).
- A Especificação Textual guiará as refatorações da Fase 2, uniformizando os "squircles" (radius de 18-24px para grandes superfícies).

## 0.8 — Light Mode Readiness (Prontidão para Light Mode)
- **Contraste:** Muito bem estruturado pelo uso intensivo de `*-foreground`.
- **FOUC (Flash of Unstyled Content):** É o **maior risco real**. Injetar a preferência de tema via React causará um piscar incômodo no bootstrap do Vite. Teremos que inserir um pequeno script bloqueante no `<head>` do `index.html` para ler o `localStorage` e anexar uma tag no html **antes** do React renderizar a DOM, caso contrário a transição Dark->Light machucará os olhos no carregamento.
- **Overlays/Filtros Pretos:** O scanner (QR) terá sua janela (hole) forçada em preto, como prevê a especificação (Seção 50.11), independente do tema global.

---

## 0.9 — Plano Estratégico (O que faremos na FASE 1)
Arquivos candidatos para a **FASE 1 (Infraestrutura Dark/Light)**:
1. `index.html` (para injetar script anti-FOUC leve);
2. `src/index.css` (para criar as classes `.dark` e separar os níveis `:root` claros);
3. Um novo arquivo de Context Provider/Zustand puramente focado em persistência de Theme (sem dependência de banco).

### STOP ACIONADO
Nenhum código foi modificado. Aguardo sua avaliação e aprovação para iniciarmos a infraestrutura pesada na **FASE 1**.
