---
name: Chat scroll state machine
description: Invariants of the mobile chat initial-scroll/stick-to-bottom logic; ordering and observer pitfalls.
---

# Chat scroll state machine (petdaycare chat page)

Rules that must hold or the chat opens at the oldest message on mobile:

0. **Never render the conversation view twice.** The mobile overlay and the desktop card must be mutually exclusive via a JS matchMedia check (`isDesktop`), NOT via CSS `hidden md:flex`. With both in the DOM, `scrollContainerRef` binds to the LAST rendered copy — the hidden desktop one (height 0) — where any scroll "lands" instantly (0-0-0 < 10) while the visible container never moves. This was the actual root cause of the "opens at oldest message" bug; all the effect-logic hardening was ineffective until fixed. In-page measurement of every `.overflow-y-auto` element (via the e2e tester) is what exposed it.

1. **Effect declaration order matters.** The layout effect that resets `initialScrolledRef=false` on `selectedTutorId` change MUST be declared BEFORE the landing effect. Effects run in declaration order within a commit; if the landing effect runs first it sees the stale sentinel and takes the smooth-scroll branch, and a cached conversation with the same message count never re-lands.
   **Why:** caught by architect review after a regression; message pages are capped at 50, so "same length across conversations" is common, not rare.
2. **Landing must be a persistent rAF loop**, not a single-frame retry: force `scrollTop=scrollHeight` each frame until `dist<10` (or ~30 frames), only then mark initialized. Slow mobile devices settle layout across several frames.
3. **ResizeObserver on the scroll container alone is useless for content growth** — the container is `flex-1` (fixed size). Observe an inner content wrapper div too, or the viewport strands mid-history when fonts/bubbles reflow.
4. Deps of the landing effect: `[allMessages.length, showConversation, selectedTutorId]` — `showConversation` because the mobile overlay mounts late; `selectedTutorId` for cached same-length switches.

**How to apply:** any refactor of `pages/chat/index.tsx` scroll logic must preserve all four invariants; test switching between two cached 50-message conversations on mobile.
