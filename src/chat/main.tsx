// The Chart assistant (chart.html), in React with shadcn/ui and AI Elements.
//
//   App.tsx              layout: top bar, conversation, chart panel
//   shell/               top bar, patient switcher, dataset picker, overflow menu   (SHELL)
//   benchmark/           benchmark question in the composer, question browser       (SHELL)
//   model/               model status and the download card                         (SHELL)
//   conversation/        thread, composer, runs, answers, generative UI, grade card  (CONVERSATION)
//   ../components/ai-elements/   AI Elements (Apache-2.0), adapted                   (CONVERSATION)
//   ../app/chart-*.ts    chart panel (plain TypeScript, mounted by ChartPanelHost)   (CHART)
// Data: src/app/state.ts (store and events), src/chart/api.ts (the in-browser backend).
import '../styles/app.css';
import '../app/tokens.css';
import './theme.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { App } from './App.tsx';
import { app, api, emit, setDev, setPatient } from '../app/state.ts';
import type { AppConfig } from '../app/state.ts';
import { activeCohort, cohortList } from '../chart/data.ts';
import type { ChartPatient } from '../types.ts';

async function load(): Promise<void> {
  const [config, cohorts, cohort, { patients }] = await Promise.all([
    api<AppConfig>('/api/config'), cohortList(), activeCohort(), api<{ patients: ChartPatient[] }>('/api/patients'),
  ]);
  Object.assign(app, { config, cohorts, cohort, patients, types: new Set(Object.keys(config.search_params)) });
  emit('ready');
  const wanted = location.hash.slice(1);
  // The #patient in the URL, else the cohort's featured patient (its chart answers every example
  // question, the trend included), else the first.
  const first = patients.find((p) => p.id === wanted) ?? patients.find((p) => p.id === cohort.featured_patient) ?? patients[0];
  if (first) setPatient(first);
}

setDev(app.dev);
// Reflect the stored panel state without writing it back (ChartPanelHost decides per width).
document.body.classList.toggle('panel-open', app.panelOpen);
// One root per page, also across hot reloads in the dev server.
const host = document.getElementById('root')!;
const holder = host as HTMLElement & { __root?: Root };
holder.__root ??= createRoot(host);
holder.__root.render(<StrictMode><App load={load} /></StrictMode>);
