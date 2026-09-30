/**
 * Country risk: INFORM Risk index (EC JRC) joined with the World Bank WGI Political Stability
 * estimate by ISO3. Owner: layers-threats-network. Server-only.
 *
 * Probed 2026-09-30: `Workflows/GetByYear/2026` 200 in 1.4 s (WorkflowId 515 "INFORM Risk Mid
 * 2026"); `countries/Scores/?WorkflowId=515&IndicatorId=INFORM` failed once with an empty reply and
 * answered 200 (24 KB) on retry, so both calls retry. WGI: `GOV_WGI_PV.EST?source=3` 200 in 0.47 s
 * (216 rows, some without an ISO3); the old `PV.EST` id answers "indicator not found".
 * Score = INFORM (0–10, higher = more risk); WGI is shown as a component, never blended.
 */
import 'server-only';
import { defineFeed, runProvider } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import type { CountryRisk } from '@/lib/types';
import { countryByIso3 } from '../shared/country';

const INFORM = 'https://drmkc.jrc.ec.europa.eu/inform-index/API/InformAPI/';
export const WGI_URL = (year: number) => `https://api.worldbank.org/v2/country/all/indicator/GOV_WGI_PV.EST?source=3&format=json&date=${year}&per_page=400`;

export const RISK_METHOD =
  'Score = INFORM Risk index (EC JRC, 0–10; ≥ 6.5 very high, 5–6.5 high, 3.5–5 medium, < 3.5 low) from the latest published workflow. ' +
  'Component wgi_pv = World Bank WGI Political Stability and Absence of Violence estimate (≈ −2.5 … +2.5, higher = more stable), joined by ISO3; it is shown, not blended.';

interface Workflow {
  WorkflowId: number;
  Name: string;
  WorkflowDate?: string;
}

export function latestWorkflow(list: Workflow[]): Workflow | null {
  const risk = list.filter((w) => /INFORM Risk/i.test(w.Name));
  return risk.sort((a, b) => Date.parse(b.WorkflowDate ?? '') - Date.parse(a.WorkflowDate ?? '') || b.WorkflowId - a.WorkflowId)[0] ?? null;
}

interface InformScore {
  Iso3: string;
  IndicatorScore: number | null;
}
type WgiRow = { countryiso3code?: string; country?: { value?: string }; value: number | null; date?: string };

export function joinRisk(inform: InformScore[], wgi: WgiRow[], workflowName: string, wgiYear: number): CountryRisk[] {
  const byIso = new Map<string, CountryRisk>();
  const sources = [`INFORM (${workflowName})`, `World Bank WGI PV.EST ${wgiYear}`];
  const get = (iso3: string, name: string | null) => {
    let r = byIso.get(iso3);
    if (!r) {
      r = { iso3, name: countryByIso3(iso3)?.name ?? name ?? iso3, score: null, components: { inform: null, wgi_pv: null }, method: RISK_METHOD, sources };
      byIso.set(iso3, r);
    }
    return r;
  };
  for (const s of inform) {
    if (!/^[A-Z]{3}$/.test(s.Iso3 ?? '')) continue;
    const v = typeof s.IndicatorScore === 'number' && Number.isFinite(s.IndicatorScore) ? s.IndicatorScore : null;
    const r = get(s.Iso3, null);
    r.score = v;
    r.components.inform = v;
  }
  for (const w of wgi) {
    const iso3 = w.countryiso3code ?? '';
    if (!/^[A-Z]{3}$/.test(iso3) || typeof w.value !== 'number') continue;
    get(iso3, w.country?.value ?? null).components.wgi_pv = Math.round(w.value * 1000) / 1000;
  }
  return [...byIso.values()].sort((a, b) => a.iso3.localeCompare(b.iso3));
}

export const countryRiskFeed = defineFeed<{ items: CountryRisk[] }>({
  key: 'country-risk',
  ttlMs: 24 * 60 * 60_000,
  pollMs: 6 * 60 * 60_000,
  kind: 'reference',
  attribution: [
    { text: 'INFORM Risk Index, European Commission Joint Research Centre', url: 'https://drmkc.jrc.ec.europa.eu/inform-index', licence: 'CC BY 4.0 (JRC)' },
    { text: 'World Bank Worldwide Governance Indicators', url: 'https://www.worldbank.org/en/publication/worldwide-governance-indicators', licence: 'CC BY 4.0' },
  ],
  count: (d) => d.items.length,
  deadlineMs: 60_000,
  run: async ({ signal }) => {
    const year = new Date().getUTCFullYear();
    let workflowName = 'INFORM Risk';
    const inform = await runProvider(
      async () => {
        let wf: Workflow | null = null;
        for (const y of [year, year - 1]) {
          wf = latestWorkflow((await httpJson<Workflow[]>(`${INFORM}Workflows/GetByYear/${y}`, { signal, timeoutMs: 20_000, retries: 3 })).data ?? []);
          if (wf) break;
        }
        if (!wf) throw new Error('no_workflow');
        workflowName = wf.Name;
        return (await httpJson<InformScore[]>(`${INFORM}countries/Scores/?WorkflowId=${wf.WorkflowId}&IndicatorId=INFORM`, { signal, timeoutMs: 25_000, retries: 3 })).data ?? [];
      },
      (r) => r.length,
    );
    // WGI is published with a lag: try the last three years, newest first.
    let wgiYear = year - 3;
    const wgi = await runProvider(
      async () => {
        for (const y of [year - 2, year - 3, year - 4]) {
          const res = await httpJson<[unknown, WgiRow[] | null]>(WGI_URL(y), { signal, timeoutMs: 20_000 });
          const rows = Array.isArray(res.data) ? (res.data[1] ?? []) : [];
          if (rows.some((r) => typeof r.value === 'number')) {
            wgiYear = y;
            return rows;
          }
        }
        return [];
      },
      (r) => r.filter((x) => typeof x.value === 'number').length,
    );
    const items = inform.result || wgi.result ? joinRisk(inform.result ?? [], wgi.result ?? [], workflowName, wgiYear) : [];
    return { data: { items }, providers: { inform: inform.run, worldbank_wgi: wgi.run } };
  },
});
