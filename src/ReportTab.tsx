import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Amt, bar, cell, cellR, today } from "./ui";

type Cur = { currency: string; start: string; end: string; delta: string };
type OpsCur = { currency: string; income: string; expense: string };
type RateU = { kind: string; currency: string; rate: string; source_date: string; source: string; gap_days: number };
type Report = {
  start_date: string; end_date: string; auto_start: boolean; currencies: Cur[];
  delta_with_reval: string | null; delta_no_reval: string | null; reval_effect: string | null;
  ops_income: string; ops_expense: string; ops_net: string; ops_count: number; ops_excluded: number;
  ops_by_currency: OpsCur[]; virtual_monthly: string;
  unmarked_with_reval: string | null; unmarked_no_reval: string | null;
  rates: RateU[]; warnings: string[];
};
type Mode = "both" | "with" | "without";

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export default function ReportTab({ hide }: { hide: boolean }) {
  const [end, setEnd] = useState(today());
  const [auto, setAuto] = useState(true);
  const [start, setStart] = useState("");
  const [mode, setMode] = useState<Mode>("both");
  const [rep, setRep] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const startKey = auto ? "" : start;

  useEffect(() => {
    if (!isDate(end)) return;
    if (!auto && !isDate(start)) return;
    let cancelled = false;
    setLoading(true);
    invoke<Report>("build_report", { end, start: auto ? null : start })
      .then((r) => { if (!cancelled) { setRep(r); setMsg(""); } })
      .catch((e) => { if (!cancelled) { setMsg(String(e)); setRep(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, auto, startKey]);

  const val = (a: string | null, neg?: boolean) =>
    a === null ? <span>н/д</span> : <Amt a={a} hide={hide} neg={neg} />;
  const showWith = mode !== "without";
  const showNo = mode !== "with";
  const big = { fontSize: 28, fontWeight: 600 as const };

  return (
    <div>
      <h3>Отчёт о движении баланса</h3>
      <p><small>
        Период (начало, конец]: операции на дату начала не входят, на дату конца входят. Остаток по валюте на дату — сумма
        последних известных позиций всех счетов. Отчёт общий по всем владельцам и регионам.
      </small></p>
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}

      <div style={bar}>
        <label>Дата отчёта: <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label>
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => { setAuto(e.target.checked); if (!e.target.checked) setStart(rep?.start_date ?? ""); }}
          /> начало — предыдущая позиция
        </label>
        <label>
          Начало:{" "}
          <input type="date" value={auto ? (rep?.start_date ?? "") : start} disabled={auto} onChange={(e) => setStart(e.target.value)} />
        </label>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="both">С переоценкой и без</option>
          <option value="with">С переоценкой</option>
          <option value="without">Без переоценки</option>
        </select>
        {loading && <span>Загрузка курсов и расчёт…</span>}
      </div>

      {rep && (
        <>
          {rep.warnings.length > 0 && (
            <div style={{ color: "#b60", marginBottom: 12 }}>
              {rep.warnings.map((w, i) => <div key={i}><small>⚠ {w}</small></div>)}
            </div>
          )}

          <h4>1. Изменение по валютам ({rep.start_date} → {rep.end_date})</h4>
          <table style={{ borderCollapse: "collapse", marginBottom: 16 }}>
            <thead>
              <tr><th style={cell}>Валюта</th><th style={cellR}>На начало</th><th style={cellR}>На конец</th><th style={cellR}>Изменение</th></tr>
            </thead>
            <tbody>
              {rep.currencies.map((c) => (
                <tr key={c.currency}>
                  <td style={cell}>{c.currency}</td>
                  <td style={cellR}>{val(c.start)}</td>
                  <td style={cellR}>{val(c.end)}</td>
                  <td style={cellR}>{val(c.delta)}</td>
                </tr>
              ))}
              {rep.currencies.length === 0 && <tr><td style={cell} colSpan={4}>Нет счетов</td></tr>}
            </tbody>
          </table>

          <h4>2. Изменение в KZT</h4>
          <table style={{ borderCollapse: "collapse", marginBottom: 16 }}>
            <tbody>
              {showWith && <tr><td style={cell}>С переоценкой</td><td style={cellR}>{val(rep.delta_with_reval)}</td></tr>}
              {showNo && <tr><td style={cell}>Без переоценки</td><td style={cellR}>{val(rep.delta_no_reval)}</td></tr>}
              <tr><td style={cell}>Эффект переоценки</td><td style={cellR}>{val(rep.reval_effect)}</td></tr>
            </tbody>
          </table>

          <h4>3. Операции за период (в KZT)</h4>
          <table style={{ borderCollapse: "collapse", marginBottom: 8 }}>
            <tbody>
              <tr><td style={cell}>Доходы</td><td style={cellR}>{val(rep.ops_income)}</td></tr>
              <tr><td style={cell}>Расходы</td><td style={cellR}>{val(rep.ops_expense, true)}</td></tr>
              <tr><td style={cell}><b>Нетто</b></td><td style={cellR}><b>{val(rep.ops_net)}</b></td></tr>
              <tr><td style={cell}>Виртуальные начисления (депозиты и кредиты)</td><td style={cellR}>{val(rep.virtual_monthly)}</td></tr>
            </tbody>
          </table>
          <p><small>
            Операций: {rep.ops_count}{rep.ops_excluded > 0 ? `, без курса исключено: ${rep.ops_excluded}` : ""}.
            Депозиты и кредиты пока не учитываются (начисления = 0).
          </small></p>
          {rep.ops_by_currency.length > 0 && (
            <table style={{ borderCollapse: "collapse", marginBottom: 16 }}>
              <thead><tr><th style={cell}>В валюте операций</th><th style={cellR}>Доходы</th><th style={cellR}>Расходы</th></tr></thead>
              <tbody>
                {rep.ops_by_currency.map((o) => (
                  <tr key={o.currency}>
                    <td style={cell}>{o.currency}</td>
                    <td style={cellR}>{val(o.income)}</td>
                    <td style={cellR}>{val(o.expense, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h4>4. Неразмеченная разница</h4>
          <div style={{ display: "flex", gap: 48, flexWrap: "wrap", marginBottom: 4 }}>
            {showWith && (
              <div>
                <div style={big}>{val(rep.unmarked_with_reval)}</div>
                <small>с переоценкой — не объяснено операциями</small>
              </div>
            )}
            {showNo && (
              <div>
                <div style={big}>{val(rep.unmarked_no_reval)}</div>
                <small>без переоценки — не объяснено операциями</small>
              </div>
            )}
          </div>
          <p><small>Показывает часть изменения баланса, не объяснённую внесёнными операциями (неучтённые доходы и расходы). Оценочная величина: курсы операций берутся на их даты.</small></p>

          {rep.rates.length > 0 && (
            <p><small>
              Курсы НБРК (KZT за 1 ед.): {rep.rates.map((r) => `${r.currency} ${r.rate} (${r.kind}, на ${r.source_date})`).join(" · ")}
            </small></p>
          )}
        </>
      )}
    </div>
  );
}
