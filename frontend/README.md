# ChaiBookLM — Frontend

React + Vite single-page app for ChaiBookLM. It manages notebooks, uploads
knowledge sources, streams grounded answers from the backend, and renders
inline citations that open the original source.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

The dev server proxies `/api` and `/uploads` to `http://127.0.0.1:8000`
(see `vite.config.js`), so start the backend first:

```bash
cd ../backend && uvicorn main:app --reload
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run lint` | Oxlint over the source tree |

## Layout

```
src/
  App.jsx                  Shell: notebook state, layout, source-viewer panel
  App.module.css           Layout and responsive breakpoints
  index.css                Design tokens (CSS variables), resets, scrollbars
  components/
    Sidebar.jsx            Notebook list, create and delete
    SourcePanel.jsx        Upload controls and per-source indexing status
    ChatInterface.jsx      Streaming chat, history, stop/clear controls
    MarkdownMessage.jsx    Markdown rendering plus [n] citation badges
    SourceViewer.jsx       Cited passage, PDF page, YouTube timestamp
    Modal.jsx              Shared prompt/confirm dialog
```

Each component pairs with a `*.module.css` file; there is no global stylesheet
beyond `index.css`.

## How citations work

1. The backend streams a `citations` event first — a map of `1..n` to source
   metadata plus the retrieved passage text.
2. The answer streams in after it, containing `[1]`-style markers.
3. `MarkdownMessage` runs a small remark plugin that lifts those markers out of
   the Markdown text and renders them as clickable badges.
4. Clicking a badge hands the metadata to `SourceViewer`, which shows the quoted
   passage alongside the PDF page or the video at the right timestamp.

Raw HTML is deliberately not enabled in the Markdown renderer, so model output is
escaped rather than executed.

## Deployment

`vercel.json` rewrites `/api/*` and `/uploads/*` to the hosted backend. Update
the destination there if the backend moves.
