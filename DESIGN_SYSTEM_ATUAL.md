# Design System Atual - ArkPet

Este documento mapeia todos os tokens, componentes, padronizações e definições visuais atualmente em uso no frontend do projeto ArkPet (localizado em `artifacts/petdaycare`).

> **Nota de Auditoria:** O sistema foi analisado de forma exploratória, com base no arquivo global de estilos (`src/index.css`) compatível com Tailwind v4 (`@theme inline`) e nos componentes da biblioteca Shadcn UI (`src/components/ui/*`).

---

## 1. Paleta de Cores (Tokens)

As cores principais são definidas via variáveis HSL globais (`:root`) e convertidas pelo Tailwind. Atualmente, o sistema parece operar estritamente em um **Dark Mode** projetado como base (Premium ArkPet). Não há bloco explícito `.light` em `index.css`.

| Nome da Variável | Valor HSL | HEX Aprox. | Descrição / Uso |
| :--- | :--- | :--- | :--- |
| `--background` | `225 9% 9%` | `#151619` | Fundo principal da aplicação (`bg-background`). |
| `--foreground` | `0 0% 100%` | `#FFFFFF` | Cor de texto primário (`text-foreground`). |
| `--card` | `220 8% 14%` | `#202226` | Fundo de superfícies elevadas, painéis e modais. |
| `--card-foreground`| `0 0% 100%` | `#FFFFFF` | Texto dentro de cards. |
| `--popover` | `220 8% 14%` | `#202226` | Fundo de dropdowns e balões (popovers). |
| `--primary` | `78 57% 50%` | `#84A93A` | Verde-lima principal para botões, inputs focados, ícones de ação e destaque. |
| `--primary-foreground`| `225 9% 9%` | `#151619` | Texto dentro de botões primários (grafite escuro). |
| `--secondary` | `220 8% 18%` | `#2A2C31` | Elementos secundários (ex: botões ghost, fundos de inputs, cabeçalhos de tabela). |
| `--secondary-foreground`| `0 0% 100%` | `#FFFFFF` | Texto dentro de elementos secundários. |
| `--muted` | `220 8% 18%` | `#2A2C31` | Fundos silenciados e estados de hover discretos. |
| `--muted-foreground` | `215 14% 65%`| `#9CA3AF` | Texto secundário/discreto, descriptions, labels não focados. |
| `--accent` | `78 57% 50%` | `#84A93A` | Cor de destaque (alias do primary). |
| `--destructive` | `0 84% 60%` | `#EF4444` | Ações destrutivas, exclusões (`bg-destructive`). |
| `--border` | `220 8% 22%` | `#33363D` | Cor padrão de **todas** as bordas de separação (`border-border`). |
| `--input` | `220 8% 22%` | `#33363D` | Bordas de input. |
| `--ring` | `78 57% 50%` | `#84A93A` | Anel de foco, usado na navegação e forms. |
| `--success` | `142 76% 36%` | `#16A34A` | Indicadores de sucesso. |
| `--warning` | `48 96% 53%` | `#FBBF24` | Indicadores de aviso. |
| `--error` | `0 84% 60%` | `#EF4444` | Indicadores de erro (alias do destructive). |

*Referências: `src/index.css` (linhas 40-73).*

---

## 2. Tipografia

- **Font Family Base (`--font-sans` e `--font-display`)**: Utiliza `Inter`, sans-serif em todos os níveis.
- **Escala e Classes**: Usa integralmente a escala padrão do Tailwind:
  - `text-xs` (geralmente usado com `text-muted-foreground` para labels/data)
  - `text-sm` (tamanho base padrão para parágrafos em mobile via clamp/appearance `input.tsx:24`, tabelas e badges)
  - `text-base` / `text-lg` (subtítulos e body em desktop)
  - `text-xl` / `text-2xl` (títulos maiores em headers e cards).
- **Pesos (`font-weight`)**:
  - `font-medium` (500) em botões, abas e cabeçalhos de tabela.
  - `font-semibold` (600) forçado via `@layer base` em todos os cabeçalhos (`h1`-`h6`) junto com `tracking-tight` (letter spacing reduzido).
  - `font-bold` (700) presente em modais e painéis vitais (ex: tela de nova reserva).

*Referências: `src/index.css` (linha 1, 82-86).*

---

## 3. Espaçamento

O sistema usa a escala utilitária nativa do Tailwind (múltiplos de 4px / `0.25rem`). 

Padrões observados frequentemente:
- **Card Padding**: `p-6` (24px) como padrão nos contêineres e headers de Card.
- **Botões Base**: `px-5 py-2` na variante default; `px-3` para `size="sm"`; `px-8` para `size="lg"`.
- **Gaps (Grid/Flex)**: O layout geral emprega `gap-4` (16px) ou `gap-6` (24px) para espaçamento entre blocos.
- **Safe Area**: Modificadores customizados no css: `.pb-safe`, `.pt-safe`, `.pb-nav-safe` lidam com o notch do iPhone e navigation gestures. O rodapé reserva `calc(72px + env(safe-area-inset-bottom))` para conviver com a nav inferior no mobile.

*Referências: `src/index.css` (linhas 144-155), `src/components/ui/card.tsx`.*

---

## 4. Bordas e Border-Radius

Os famosos "squircles" / formas arredondadas predominam. Foi implementado no `@theme inline`:

- `--radius-sm`: `0.5rem` (8px)
- `--radius-md`: `0.75rem` (12px)
- `--radius-lg`: `1rem` (16px)
- `--radius-xl`: `1.5rem` (24px)
- `--radius-2xl`: `2rem` (32px)
- `--radius-full`: `9999px`

**Distribuição Atual:**
- **Buttons** (`variant="default"`): Totalmente pílulas usando `rounded-full`. (Botões sizes menores ou maiores diferem — ver inconsistências).
- **Inputs**: Extremamente arredondados com `rounded-2xl`.
- **Cards Globais**: Utilizam `rounded-2xl` (antigos glass-panels).
- **Badges**: Pílulas redondas (`rounded-full`).
- **Modais**: Mobile usa bottom-sheet com topo arredondado (`rounded-t-3xl`), enquanto em Desktop o modal central usa `rounded-2xl`.
- **Dropdowns / Menus**: Usa `rounded-md` ou `rounded-sm` nativo do Shadcn original.
- **Alert Dialogs**: `sm:rounded-xl` (1.5rem).

*Referências: `src/components/ui/button.tsx`, `input.tsx`, `card.tsx`, `modal.tsx`.*

---

## 5. Sombras / Elevação

Sem valores rígidos hardcoded de hexadeximal; as sombras delegam à base tailwind usando os modifiers semipesados típicos do dark mode:
- **`shadow-sm`**: Cards base, botões (`Button variant="default"`).
- **`shadow-md`**: Menu de contexto principal do `DropdownMenu`.
- **`shadow-lg`**: Usado amplamente em **Modais**, **Alert Dialogs** e submenus flutuantes.
- Curiosidade: os botões e backgrounds removeram intensamente o estilo "glass" para se tornarem blocos opacos, contudo alguns `backdrop-blur-sm` continuam usados nas máscaras de modals (`bg-black/60`).

---

## 6. Ícones

- **Biblioteca**: `lucide-react`
- **Tamanhos Padrão**: 
  - `h-4 w-4` (16px): Ícones in-line em botões (ex: spinner Loader2, ChevronRight, X).
  - `h-5 w-5` (20px): Inputs que possuem ícones (lupa/search).
  - `h-6 w-6` (24px): Menus ou áreas que requerem maior affordance touch.
- **Cor**: Comumente usam a cor herdada da fonte (stroke) ou `text-muted-foreground` quando formam decorators em campos de input.

---

## 7. Responsividade e Padrões de Layout

- O sistema é altamente **Mobile-First**. As telas pequenas usam estruturas lineares e o bottom navigation.
- **Mobile**:
  - Modais abrem como Bottom Sheets cobrindo `modal-max-h` (92svh para corrigir falhas do Safari toolbar).
  - Inputs tem classe mista `text-base md:text-sm` (iOS dá auto-zoom se a fonte num input for menor que 16px).
- **Desktop (md / lg up)**:
  - Componentes flutuantes (como `Modal`) ancoram ao centro com `md:inset-0 md:max-w-lg md:rounded-2xl`.
  - Tabelas clássicas (ex: `admin/users.tsx` ou `bookings/index.tsx`) costumam usar a variante original `table` em vez da empilhada, com `overflow-x-auto` no respectivo wrapper da tabela.
  - O conteúdo base nas views utiliza max-widths clássicos como `max-w-4xl`, ou `.container`.

---

## 8. Estados de Interação

- **Hover**: Quase todos os fundos escuros reagem trocando para `/80` ou `bg-secondary`. Ex: Botão Ghost (`hover:bg-accent`), Trs da tabela (`hover:bg-secondary`).
- **Focus**: Padrão do Shadcn implementado consistentemente via: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`. Usado em links, botões e inputs.
- **Disabled**: Reduz a opacidade de botões via `disabled:opacity-50 disabled:pointer-events-none`.
- **Scrollbars Customizadas**: Scrollbars grossas de OS trocadas pelas variações `custom-scrollbar` e `scrollbar-sleek` (6px largura, transparent track e border thumb).
- **iOS Safari Fixes Globais**: Tap highlights desabilitados e `touch-action: manipulation` para remover os 300ms de delay nos cliques de botões mobile (`index.css`).

---

## 9. Variantes de Componentes Shadcn UI Implementadas

### Button (`button.tsx`)
- **Variants**: `default` (padrão), `outline`, `ghost`, `glass` (blur), `destructive`, `secondary`, `link`.
- **Sizes**: `default` (h-11, px-5, pílula), `sm` (h-9, rounded-md), `lg` (h-12, rounded-xl), `icon` (h-11, w-11).

### Badge (`badge.tsx`)
- **Variants**: `default`, `secondary`, `outline`, `destructive`, `success`, `warning`.
- Emprega sempre pílulas (`rounded-full`).

### Input (`input.tsx`)
- Apenas um formato default. Aceita a prop `icon` para embutir Lucide Icons à esquerda.

### Card (`card.tsx`)
- Sem variantes adicionais, compõe via Header, Title, Description, Content, Footer em uma caixa opaca baseada em `bg-card rounded-2xl`.

### Modal (`modal.tsx`)
- Adaptativo customizado internamente com framer-motion (scale up no desktop, slide up no mobile).

---

## 10. Inconsistências Encontradas (Para Review e Polimento Futuro)

1. **Border Radius em Botões**: 
   - A variante `size="default"` usa `rounded-full` (comportamento de pílula ditado pelo redesign).
   - O `size="sm"` usa `rounded-md` (que na variável vale `0.75rem`/12px).
   - O `size="lg"` usa `rounded-xl` (1.5rem/24px).
   - *Justificativa Aparente*: Herdado do Shadcn antigo; resultará em botões grandes/pequenos não sendo "pílulas" como os médios.
2. **Border Radius de Superfícies (Modais vs Cards)**:
   - `Card` e `Input` usam `rounded-2xl` (32px).
   - Modais Desktop usam `rounded-2xl` (32px), mas o *AlertDialog* usa `sm:rounded-xl` (24px) nas telas maiores, o que provoca descasamento visual nas bordas se abertos consecutivamente.
   - Os popovers do `DropdownMenu` mantiveram as propriedades primitivas do Radix `rounded-md`, o que entra em conflito agressivo com as curvas profundas da UI nova.
3. **Badges - Inconsistência de Fundo Analógico**:
   - `success` usa `bg-success/10 text-success` (fundo translúcido).
   - `warning` usa `bg-warning/10 text-warning` (fundo translúcido).
   - `destructive` usa `bg-destructive text-destructive-foreground` (fundo SÓLIDO). Idealmente deveria seguir a mesma sintaxe (`/10`) para parear com sucesso/aviso em relatórios.
4. **Resquícios de Glassmorphism**:
   - O arquivo `index.css` prescreve classes como `.glass-button` (com `bg-secondary/50 backdrop-blur-md`). No redesign principal de Fase 1 a Fase 5 todos os valores foram alterados para uso de elementos opacos (`bg-secondary`), porém estas helper classes ainda residem no css base.
