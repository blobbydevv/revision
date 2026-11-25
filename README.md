# Revise NI

A CCEA GCSE revision site for Northern Ireland: spaced-repetition flashcards,
two tiers of quiz, blurting, topic checklists and a focus timer — organised by
subject and topic, with local profiles so several people can share a browser.

- **26 subjects**, **120 topics**, **740 flashcards**
- **Leitner boxes 1-5** schedule reviews at 1, 2, 4, 8 and 16 days
- **Topic quizzes** (6 questions, one topic) and **subject quizzes** (15 questions, all topics mixed)
- **Blurting** with per-topic key points and automatic gap-queueing
- **Focus timer** with 25/5, 50/10 and 15/3 presets
- **Revision methods** ranked by the strength of the evidence behind them

## Accounts

Accounts are stored in this browser only — there is no server and nothing is
uploaded. Passwords are PBKDF2-hashed (120k iterations, SHA-256, per-user salt)
so they are not held in plain text, but this protects a profile from casual
snooping on a shared computer, **not** from anyone with real access to the
machine. The sign-in screen says so. Users should not reuse a password.

Signing in lets someone pick their year group and the subjects they actually
take, and keeps their boxes, streak and quiz scores separate from other
profiles on the same device. The site is fully usable without an account.

## Structure

```
index.html          markup and all views
assets/styles.css   design tokens and components
assets/data.js      subjects -> topics -> cards, plus methods and year groups
assets/app.js       accounts, decks, quizzes, timer, routing
```

## Running it

Serve the folder (needed for WebCrypto, which requires a secure context):

```bash
python3 -m http.server
```

## Deployment

Pushed to GitHub Pages by `.github/workflows/pages.yml` on every push to the
development branch.
