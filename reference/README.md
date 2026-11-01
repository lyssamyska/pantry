# Reference material (not part of the running app)

- `meal-agent-starter/` — older Next.js scaffold. Port from it, don't run it:
  - `lib/compliance.ts` — gluten/sugar banned list + protein sourcing rules (fix: unquoted `sea bass` key; never flag "<x>-free" or "no <x>")
  - `lib/auth.ts` — bcrypt email/password auth, to replace Polsia OTP
  - `lib/scraper.ts` — JSON-LD (@graph) + microdata recipe extraction
- `api-research.md` — grocery API research (Instacart, Favor, H-E-B, Sprouts)
