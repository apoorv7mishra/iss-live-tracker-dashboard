# ISS News AI Dashboard

A React + Vite dashboard for live ISS tracking, latest news, charts, dark/light mode, and a restricted AI chatbot powered by Hugging Face.

## Features

- Live ISS location refresh every 15 seconds
- Leaflet map with custom ISS marker and last 15-position trajectory
- Haversine speed calculation with a live line chart
- People currently in space from Open Notify
- Latest science and technology news with search, sorting, refresh, and 15-minute localStorage cache
- News distribution doughnut chart with click-to-filter
- Floating chatbot that answers only from current dashboard data
- Dark/light mode, toasts, loading skeletons, responsive layout

## Environment

Create `.env` locally:

```bash
VITE_NEWS_API_KEY=your_newsapi_key_here
VITE_AI_TOKEN=your_huggingface_key_here
```

Never commit `.env`. It is already included in `.gitignore`.

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

Add these variables in Vercel:

- `VITE_NEWS_API_KEY`
- `VITE_AI_TOKEN`

Then deploy:

```bash
vercel --prod
```

## Assignment Answer

The LLM model used is `mistralai/Mistral-7B-Instruct-v0.2` through the Hugging Face Inference API. I used it because it is an instruction-tuned model that can follow a strict system prompt and answer concisely from the dashboard context. The app sends only the current ISS, astronaut, and loaded news data to the model, and the chatbot is instructed not to use outside knowledge or guess.
