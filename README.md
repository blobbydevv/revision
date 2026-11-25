# Revise NI

A single-page revision site for CCEA GCSEs: spaced-repetition flashcards (Leitner boxes 1–5),
quick-fire quizzes, blurt sheets, topic checklists, a focus timer, and revision methods ranked
by evidence strength.

26 subjects, ~190 cards. Progress is stored in the browser's `localStorage` only — nothing is
sent anywhere, and there is no build step or dependency.

## Running it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server
```

## Deployment

Static GitHub Pages site served from the repository root (`index.html`). `.nojekyll` stops
Jekyll from processing the files.
