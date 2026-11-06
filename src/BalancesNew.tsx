import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

type Item = { id: number; name: string };
type LineBalance = {
  line_id: number;
  label: string;
  owner_id: number | null;
  owner: string;
  region_name: string;
  region: string;
  place: string;
  name: string | null;
  currency: string;
  is_tax: boolean;
  date: string | null;
  amount_minor: number | null;
  amount: string | null;
  is_draft: boolean;
};
type GroupTotal = { label: string; parts: { currency: string; amount_minor: number; amount: string }[]; kzt: string | null; kzt_minor: number | null };
type RateUsed = { currency: string; rate: string; source_date: string; source: string; gap_days: number };
type Balances = {
  rows: LineBalance[];
  groups: GroupTotal[];
  grand_kzt: string | null;
  rates: RateUsed[];
  missing_rates: string[];
};
type Refresh = { requested: number; fetched: number; failed: string[]; offline: boolean; skipped: boolean };

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

const GROUPS: [string, string][] = [
  ["currency", "Валюта"],
  ["region", "Регион"],
  ["region_currency", "Регион и валюта"],
  ["owner", "Владелец"],
  ["owner_currency", "Владелец и валюта"],
  ["all", "Общий итог"],
];

const DRAFT_BG = "#fffbeb";

export function BalancesNewTab({ hide }: { hide: boolean }) {
  if (hide) return null;
  
  const [owners, setOwners] = useState<Item[]>([]);
  const [asOf, setAsOf] = useState(today());
  const [ownerId, setOwnerId] = useState("");
  const [region, setRegion] = useState("");
  const [hideZero, setHideZero] = useState(true);
  const [group, setGroup] = useState("region_currency");
  const [data, setData] = useState<Balances>({ rows: [], groups: [], grand_kzt: null, rates: [], missing_rates: [] });
  const [_rep, setRep] = useState<Refresh | null>(null);
  const [_tick, setTick] = useState(0);
  const [msg, setMsg] = useState("");

  const [includeTaxInTotal, setIncludeTaxInTotal] = useState(false);
  const [targetCurrency, setTargetCurrency] = useState("KZT");
  const [isolateUsdEur, setIsolateUsdEur] = useState(true);

  const [showMain, setShowMain] = useState(true);
  const [showTaxRows, setShowTaxRows] = useState(true);
  const [showSummary, setShowSummary] = useState(true);

  useEffect(() => {
    invoke<Item[]>("list_owners").then(setOwners).catch((e) => setMsg(String(e)));
  }, []);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return;
    let cancelled = false;
    invoke<Refresh>("refresh_rates", { dates: [asOf] })
      .then((r) => { if (!cancelled) { setRep(r); setTick((t) => t + 1); } })
      .catch((e) => { if (!cancelled) setMsg(String(e)); });
    return () => { cancelled = true; };
  }, [asOf]);

  useEffect(() => {
    let cancelled = false;
    invoke<Balances>("current_balances", {
      asOf, ownerId: ownerId ? Number(ownerId) : null, region, hideZero, group,
    })
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) setMsg(String(e)); });
    return () => { cancelled = true; };
  }, [asOf, ownerId, region, hideZero, group, _tick]);

  const regularRows = data.rows.filter((r) => !r.is_tax);
  const taxRows = data.rows.filter((r) => r.is_tax);

  return (
    <div style={{ padding: "8px 4px", fontFamily: "inherit" }}>
      {msg && <div style={{ padding: 12, marginBottom: 16, background: "#fee2e2", color: "#b91c1c", borderRadius: 8 }}>{msg}</div>}

      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px", marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>На дату</label>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Владелец</label>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }}>
            <option value="">Все владельцы</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Регион</label>
          <select value={region} onChange={(e) => setRegion(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb" }}>
            <option value="">Все регионы</option>
            <option value="KZ">Казахстан</option>
            <option value="GE">Грузия</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", paddingTop: 18 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: "#374151" }}>
            <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} style={{ width: 16, height: 16 }} /> 
            Скрыть нулевые счета
          </label>
        </div>
      </div>

      {/* Основные активы */}
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", overflow: "hidden" }}>
        <div onClick={() => setShowMain(!showMain)} style={{ padding: "16px 20px", borderBottom: showMain ? "1px solid #e5e7eb" : "none", background: "#fdfdfd", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}>
          <h3 style={{ margin: 0, fontSize: 16, color: "#111827" }}>Основные активы ({regularRows.length})</h3>
          <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>{showMain ? "▼ Свернуть" : "▶ Развернуть"}</span>
        </div>
        {showMain && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#f9fafb", color: "#4b5563", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: "12px 16px" }}>Владелец</th>
                  <th style={{ padding: "12px 16px" }}>Регион</th>
                  <th style={{ padding: "12px 16px" }}>Где лежат</th>
                  <th style={{ padding: "12px 16px" }}>Пояснение</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>Остаток</th>
                  <th style={{ padding: "12px 16px" }}>Валюта</th>
                  <th style={{ padding: "12px 16px" }}>Актуально на</th>
                </tr>
              </thead>
              <tbody>
                {regularRows.map((r) => {
                  const stale = r.date !== null && daysBetween(asOf, r.date) > 31;
                  return (
                    <tr key={r.line_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "12px 16px" }}>{r.owner || "—"}</td>
                      <td style={{ padding: "12px 16px" }}>{r.region_name}</td>
                      <td style={{ padding: "12px 16px" }}>{r.place}</td>
                      <td style={{ padding: "12px 16px", fontWeight: 500 }}>{r.name}</td>
                      <td style={{ padding: "12px 16px", textAlign: "right", background: r.is_draft ? DRAFT_BG : undefined, fontWeight: 600 }} title={r.is_draft ? "Черновик: не подтверждён" : undefined}>
                        {r.amount === null ? "—" : r.amount}
                      </td>
                      <td style={{ padding: "12px 16px" }}><span style={{ background: "#e5e7eb", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>{r.currency}</span></td>
                      <td style={{ padding: "12px 16px", color: stale ? "#d97706" : "#6b7280" }}>{r.date ?? "нет данных"}{stale ? " ⚠️" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Налоги */}
      {taxRows.length > 0 && (
        <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", overflow: "hidden" }}>
          <div onClick={() => setShowTaxRows(!showTaxRows)} style={{ padding: "16px 20px", borderBottom: showTaxRows ? "1px solid #e5e7eb" : "none", background: "#fdf8f6", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}>
            <h3 style={{ margin: 0, fontSize: 16, color: "#9a3412" }}>Налоги (отложенные до платежей) ({taxRows.length})</h3>
            <span style={{ fontSize: 13, color: "#9a3412", fontWeight: 500 }}>{showTaxRows ? "▼ Свернуть" : "▶ Развернуть"}</span>
          </div>
          {showTaxRows && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "#fffaf5", color: "#9a3412", borderBottom: "1px solid #fed7aa" }}>
                    <th style={{ padding: "12px 16px" }}>Владелец</th>
                    <th style={{ padding: "12px 16px" }}>Регион</th>
                    <th style={{ padding: "12px 16px" }}>Где лежат</th>
                    <th style={{ padding: "12px 16px" }}>Пояснение</th>
                    <th style={{ padding: "12px 16px", textAlign: "right" }}>Остаток</th>
                    <th style={{ padding: "12px 16px" }}>Валюта</th>
                    <th style={{ padding: "12px 16px" }}>Актуально на</th>
                  </tr>
                </thead>
                <tbody>
                  {taxRows.map((r) => {
                    const stale = r.date !== null && daysBetween(asOf, r.date) > 31;
                    return (
                      <tr key={r.line_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "12px 16px" }}>{r.owner || "—"}</td>
                        <td style={{ padding: "12px 16px" }}>{r.region_name}</td>
                        <td style={{ padding: "12px 16px" }}>{r.place}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 500 }}>{r.name}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", background: r.is_draft ? DRAFT_BG : undefined }} title={r.is_draft ? "Черновик: не подтверждён" : undefined}>
                          {r.amount === null ? "—" : r.amount}
                        </td>
                        <td style={{ padding: "12px 16px" }}><span style={{ background: "#ffedd5", color: "#c2410c", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>{r.currency}</span></td>
                        <td style={{ padding: "12px 16px", color: stale ? "#d97706" : "#6b7280" }}>{r.date ?? "нет данных"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Сводка и итоги */}
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <div onClick={() => setShowSummary(!showSummary)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showSummary ? 16 : 0, cursor: "pointer", userSelect: "none" }}>
          <h3 style={{ margin: 0, fontSize: 18, color: "#111827" }}>Сводка и итоги</h3>
          <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>{showSummary ? "▼ Свернуть" : "▶ Развернуть"}</span>
        </div>

        {showSummary && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12, marginTop: 12 }}>
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontSize: 14, color: "#374151" }}>
                  Группировка:{" "}
                  <select value={group} onChange={(e) => setGroup(e.target.value)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #d1d5db" }}>
                    {GROUPS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 14, color: "#374151" }}>
                  Валюта итогов:{" "}
                  <select value={targetCurrency} onChange={(e) => setTargetCurrency(e.target.value)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontWeight: 600, color: "#2563eb" }}>
                    {["KZT", "USD", "EUR", "RUB"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div style={{ display: "flex", gap: 20, marginBottom: 16, background: "#f8fafc", padding: "10px 16px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: "#334155" }}>
                <input type="checkbox" checked={includeTaxInTotal} onChange={(e) => setIncludeTaxInTotal(e.target.checked)} style={{ width: 15, height: 15 }} />
                Включать налоги в общие итоги
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: "#334155" }}>
                <input type="checkbox" checked={isolateUsdEur} onChange={(e) => setIsolateUsdEur(e.target.checked)} style={{ width: 15, height: 15 }} />
                Изолировать USD/EUR в отдельный блок
              </label>
            </div>

            {(() => {
              const mainSourceRows = data.rows.filter((r) => (r as any).amount_minor !== null && (includeTaxInTotal || !r.is_tax));
              const taxSourceRows = data.rows.filter((r) => (r as any).amount_minor !== null && r.is_tax);

              const isIsolated = (cur: string) => isolateUsdEur && (cur === "USD" || cur === "EUR");

              const mainRows = mainSourceRows.filter((r) => !isIsolated(r.currency));
              const isolatedRows = mainSourceRows.filter((r) => isIsolated(r.currency));

              const buildSummary = (rows: typeof data.rows) => {
                const aggMap = new Map<string, { label: string; partsMap: Map<string, number> }>();
                const allPartsMap = new Map<string, number>();

                for (const r of rows) {
                  const m = (r as any).amount_minor ?? 0;
                  let groupKey = r.region_name;
                  let groupLabel = r.region_name;
                  if (group === "currency") { groupKey = r.currency; groupLabel = r.currency; }
                  else if (group === "owner") { groupKey = r.owner || "—"; groupLabel = r.owner || "—"; }
                  else if (group === "owner_currency") { groupKey = `${r.owner || "—"}_${r.currency}`; groupLabel = `${r.owner || "—"} · ${r.currency}`; }
                  else if (group === "region_currency") { groupKey = `${(r as any).region}_${r.currency}`; groupLabel = `${r.region_name} · ${r.currency}`; }
                  else if (group === "all") { groupKey = "all"; groupLabel = "Всего"; }

                  if (!aggMap.has(groupKey)) {
                    aggMap.set(groupKey, { label: groupLabel, partsMap: new Map() });
                  }
                  const g = aggMap.get(groupKey)!;
                  g.partsMap.set(r.currency, (g.partsMap.get(r.currency) || 0) + m);
                  allPartsMap.set(r.currency, (allPartsMap.get(r.currency) || 0) + m);
                }

                const rateMap = new Map<string, number>();
                rateMap.set("KZT", 1);
                for (const rt of data.rates) {
                  const num = parseFloat(rt.rate.replace(/\s/g, "").replace(",", "."));
                  if (!isNaN(num)) rateMap.set(rt.currency, num);
                }

                const convertToTarget = (partsMap: Map<string, number>) => {
                  let totalKzt = 0;
                  for (const [cur, amt] of partsMap.entries()) {
                    const realAmt = amt / 100;
                    const rToKzt = rateMap.get(cur) ?? (cur === "KZT" ? 1 : null);
                    if (rToKzt !== null) totalKzt += realAmt * rToKzt;
                  }
                  const targetRate = rateMap.get(targetCurrency) ?? (targetCurrency === "KZT" ? 1 : 1);
                  const res = targetRate > 0 ? totalKzt / targetRate : 0;
                  return Math.floor(res);
                };

                const groupsResult = Array.from(aggMap.values()).map((g) => {
                  const parts = Array.from(g.partsMap.entries()).map(([currency, amount_minor]) => ({
                    currency,
                    amount_minor,
                    amount: Math.floor(amount_minor / 100).toLocaleString("ru-RU", { maximumFractionDigits: 0 })
                  }));
                  const convertedVal = convertToTarget(g.partsMap);
                  return {
                    label: g.label,
                    parts,
                    convertedStr: convertedVal.toLocaleString("ru-RU", { maximumFractionDigits: 0 })
                  };
                });

                const grandConverted = convertToTarget(allPartsMap);
                const grandStr = grandConverted.toLocaleString("ru-RU", { maximumFractionDigits: 0 });

                return { groups: groupsResult, grandStr };
              };

              const mainSummary = buildSummary(mainRows);
              const isolatedSummary = isolateUsdEur ? buildSummary(isolatedRows) : null;
              const taxSummary = !includeTaxInTotal && taxSourceRows.length > 0 ? buildSummary(taxSourceRows) : null;

              return (
                <>
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 14, marginBottom: 16 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb", color: "#4b5563", borderBottom: "1px solid #e5e7eb" }}>
                        <th style={{ padding: "12px 16px" }}>Группа</th>
                        <th style={{ padding: "12px 16px", textAlign: "right" }}>Суммы по валютам</th>
                        <th style={{ padding: "12px 16px", textAlign: "right" }}>~ в {targetCurrency}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mainSummary.groups.map((g) => (
                        <tr key={g.label} style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <td style={{ padding: "12px 16px", fontWeight: 500 }}>{g.label}</td>
                          <td style={{ padding: "12px 16px", textAlign: "right" }}>
                            {g.parts.map((p) => (
                              <div key={p.currency}><span style={{ fontWeight: 600 }}>{p.amount}</span> <span style={{ color: "#6b7280", fontSize: 12 }}>{p.currency}</span></div>
                            ))}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600 }}>{g.convertedStr}</td>
                        </tr>
                      ))}
                      <tr style={{ background: "#f0fdf4", borderTop: "2px solid #bbf7d0" }}>
                        <td style={{ padding: "14px 16px", fontWeight: 700, color: "#166534" }}>Итого основные ({targetCurrency})</td>
                        <td style={{ padding: "14px 16px" }}></td>
                        <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 700, fontSize: 16, color: "#166534" }}>{mainSummary.grandStr}</td>
                      </tr>
                    </tbody>
                  </table>

                  {isolateUsdEur && isolatedSummary && isolatedSummary.groups.length > 0 && (
                    <div style={{ marginTop: 24, border: "1px dashed #cbd5e1", borderRadius: 8, padding: 16, background: "#fafaf9" }}>
                      <h4 style={{ margin: "0 0 12px 0", fontSize: 15, color: "#57534e" }}>Валютный резерв (USD / EUR вне основных активов)</h4>
                      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 14 }}>
                        <thead>
                          <tr style={{ color: "#78716c", borderBottom: "1px solid #e7e5e4" }}>
                            <th style={{ padding: "8px 12px" }}>Группа</th>
                            <th style={{ padding: "8px 12px", textAlign: "right" }}>Суммы</th>
                            <th style={{ padding: "8px 12px", textAlign: "right" }}>~ в {targetCurrency}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {isolatedSummary.groups.map((g) => (
                            <tr key={g.label} style={{ borderBottom: "1px solid #f5f5f4" }}>
                              <td style={{ padding: "8px 12px" }}>{g.label}</td>
                              <td style={{ padding: "8px 12px", textAlign: "right" }}>
                                {g.parts.map((p) => (
                                  <span key={p.currency}>{p.amount} {p.currency}</span>
                                ))}
                              </td>
                              <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600 }}>{g.convertedStr}</td>
                            </tr>
                          ))}
                          <tr>
                            <td style={{ padding: "10px 12px", fontWeight: 600, color: "#44403c" }}>Всего USD/EUR</td>
                            <td style={{ padding: "10px 12px" }}></td>
                            <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#44403c" }}>{isolatedSummary.grandStr}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {taxSummary && taxSummary.groups.length > 0 && (
                    <div style={{ marginTop: 24, border: "1px dashed #fdba74", borderRadius: 8, padding: 16, background: "#fffaf5" }}>
                      <h4 style={{ margin: "0 0 12px 0", fontSize: 15, color: "#9a3412" }}>Налоговые резервы (исключены из общих итогов)</h4>
                      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 14 }}>
                        <thead>
                          <tr style={{ color: "#c2410c", borderBottom: "1px solid #fed7aa" }}>
                            <th style={{ padding: "8px 12px" }}>Группа</th>
                            <th style={{ padding: "8px 12px", textAlign: "right" }}>Суммы</th>
                            <th style={{ padding: "8px 12px", textAlign: "right" }}>~ в {targetCurrency}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {taxSummary.groups.map((g) => (
                            <tr key={g.label} style={{ borderBottom: "1px solid #fff7ed" }}>
                              <td style={{ padding: "8px 12px" }}>{g.label}</td>
                              <td style={{ padding: "8px 12px", textAlign: "right" }}>
                                {g.parts.map((p) => (
                                  <span key={p.currency}>{p.amount} {p.currency}</span>
                                ))}
                              </td>
                              <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600 }}>{g.convertedStr}</td>
                            </tr>
                          ))}
                          <tr>
                            <td style={{ padding: "10px 12px", fontWeight: 600, color: "#9a3412" }}>Всего налогов</td>
                            <td style={{ padding: "10px 12px" }}></td>
                            <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#9a3412" }}>{taxSummary.grandStr}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              );
            })()}

            {data.rates.length > 0 && (
              <div style={{ marginTop: 16, fontSize: 12, color: "#9ca3af", borderTop: "1px solid #f3f4f6", paddingTop: 10 }}>
                Курсы: {data.rates.map((r) => `${r.currency} ${r.rate} (${r.source_date})`).join(" · ")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
