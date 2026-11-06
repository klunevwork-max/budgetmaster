import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Amt, AmountInput, DRAFT_BG, DeleteButton, bar, cell, cellR, formatInput, today, whole } from "./ui";

const CURRENCIES = ["KZT", "USD", "EUR", "RUB"];
const REGIONS = [{ v: "KZ", t: "Казахстан" }, { v: "RU", t: "Россия" }];
const regionName = (v: string) => REGIONS.find((r) => r.v === v)?.t ?? v;

type Item = { id: number; name: string };
type Line = {
  is_tax: boolean;
  id: number; owner_id: number | null; owner: string; region: string; kind: string;
  bank_id: number | null; bank_name: string | null; name: string; currency: string; label: string;
  is_deposit: boolean; interest_rate_bps: number;
};
type Snapshot = { id: number; line_id: number; line_label: string; date: string; currency: string; amount: string; is_draft: boolean };
type LineBalance = {
  line_id: number; owner: string; region_name: string; place: string; name: string;
  currency: string; date: string | null; amount: string | null; is_draft: boolean;
};
type GroupPart = { currency: string; amount: string };
type GroupTotal = { label: string; parts: GroupPart[]; kzt: string | null };
type RateUsed = { currency: string; rate: string; source_date: string; source: string; gap_days: number };
type Balances = {
  rows: LineBalance[]; groups: GroupTotal[]; grand_kzt: string | null;
  rates: RateUsed[]; missing_rates: string[];
};
type Refresh = { requested: number; fetched: number; failed: string[]; offline: boolean; skipped: boolean };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

/* ---------------- Актуальные балансы ---------------- */

const GROUPS: [string, string][] = [
  ["currency", "валюте"],
  ["region", "региону"],
  ["region_currency", "региону и валюте"],
  ["owner", "владельцу"],
  ["owner_currency", "владельцу и валюте"],
  ["all", "всего"],
];

export function CurrentTab({ hide }: { hide: boolean }) {
  const [owners, setOwners] = useState<Item[]>([]);
  const [asOf, setAsOf] = useState(today());
  const [ownerId, setOwnerId] = useState("");
  const [region, setRegion] = useState("");
  const [hideZero, setHideZero] = useState(true);
  const [group, setGroup] = useState("region_currency");
  const [data, setData] = useState<Balances>({ rows: [], groups: [], grand_kzt: null, rates: [], missing_rates: [] });
  const [rep, setRep] = useState<Refresh | null>(null);
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState("");

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
      .then((d) => { if (!cancelled) { setData(d); setMsg(""); } })
      .catch((e) => { if (!cancelled) setMsg(String(e)); });
    

  return () => { cancelled = true; };
  }, [asOf, ownerId, region, hideZero, group, tick]);

  const warnRates = data.rates.filter((r) => r.gap_days > 7 || r.source === "cache_prev");

  

  return (
    <div>
      <h3>Актуальные балансы</h3>
      <p><small>Последняя известная позиция по каждому счёту на выбранную дату. Дата старше 31 дня подсвечивается. Жёлтым выделены черновики: перенесённые, но не подтверждённые остатки.</small></p>
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}
      <div style={bar}>
        <label>На дату: <input type="date" value={asOf} onChange={(e) => { setAsOf(e.target.value); e.target.blur(); }} /></label>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">все владельцы</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">все регионы</option>
          {REGIONS.map((r) => <option key={r.v} value={r.v}>{r.t}</option>)}
        </select>
        <label><input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /> скрыть нулевые (закрытые)</label>
      </div>

      <table style={{ borderCollapse: "collapse", marginBottom: 16 }}>
        <thead>
          <tr>
            <th style={cell}>Владелец</th><th style={cell}>Регион</th><th style={cell}>Где лежат</th>
            <th style={cell}>Строка</th><th style={cellR}>Остаток</th><th style={cell}>Валюта</th><th style={cell}>Актуально на</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => {
            const stale = r.date !== null && daysBetween(asOf, r.date) > 31;
            

  return (
              <tr key={r.line_id}>
                <td style={cell}>{r.owner || "—"}</td>
                <td style={cell}>{r.region_name}</td>
                <td style={cell}>{r.place}</td>
                <td style={cell}>{r.name}</td>
                <td style={{ ...cellR, background: r.is_draft ? DRAFT_BG : undefined }} title={r.is_draft ? "Черновик: не подтверждён" : undefined}>{r.amount === null ? "—" : <Amt a={r.amount} hide={hide} />}</td>
                <td style={cell}>{r.currency}</td>
                <td style={{ ...cell, color: stale ? "#b60" : undefined }}>{r.date ?? "нет данных"}{stale ? " (давно)" : ""}</td>
              </tr>
            );
          })}
          {data.rows.length === 0 && (
            <tr><td style={cell} colSpan={7}>Нет счетов по выбранным условиям. Добавьте их на вкладке «Счета и банки».</td></tr>
          )}
        </tbody>
      </table>

      <h4>Итого</h4>
      <div style={bar}>
        <label>
          Группировать по:{" "}
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            {GROUPS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
      </div>
      <table style={{ borderCollapse: "collapse", marginBottom: 8 }}>
        <thead>
          <tr><th style={cell}>Группа</th><th style={cellR}>Суммы по валютам</th><th style={cellR}>≈ в KZT</th></tr>
        </thead>
        <tbody>
          {data.groups.map((g) => (
            <tr key={g.label}>
              <td style={cell}>{g.label}</td>
              <td style={cellR}>
                {g.parts.map((p) => (
                  <div key={p.currency}><Amt a={p.amount} hide={hide} /> {p.currency}</div>
                ))}
              </td>
              <td style={cellR}>{g.kzt === null ? "н/д" : <Amt a={g.kzt} hide={hide} />}</td>
            </tr>
          ))}
          <tr>
            <td style={cell}><b>Всего в KZT</b></td>
            <td style={cell}></td>
            <td style={cellR}><b>{data.grand_kzt === null ? "н/д" : <Amt a={data.grand_kzt} hide={hide} />}</b></td>
          </tr>
        </tbody>
      </table>

      {data.rates.length > 0 && (
        <p><small>
          Курсы НБРК (KZT за 1 ед.): {data.rates.map((r) => `${r.currency} ${r.rate} (на ${r.source_date})`).join(" · ")}
        </small></p>
      )}
      {warnRates.length > 0 && (
        <p style={{ color: "#b60" }}><small>
          Курс не на выбранную дату: {warnRates.map((r) => `${r.currency} — ${r.source === "cache_prev" ? "из кэша, не обновлён" : "разрыв"} ${r.gap_days} дн.`).join("; ")}.
        </small></p>
      )}
      {data.missing_rates.length > 0 && (
        <p style={{ color: "#b00" }}><small>
          Нет курса: {data.missing_rates.join(", ")}. Итоги в KZT неполные{rep?.offline ? " (нет связи с НБРК)" : ""}.
        </small></p>
      )}
    </div>
  );
}

/* ---------------- Ввод позиций ---------------- */

type CopyResult = { created: number; skipped_existing: number; skipped_closed: number; skipped_empty: number };

export function Snapshots({ hide }: { hide: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [rows, setRows] = useState<Snapshot[]>([]);
  const [lineId, setLineId] = useState("");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [filterLine, setFilterLine] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [copyDate, setCopyDate] = useState(today());
  const [info, setInfo] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const l = await invoke<Line[]>("list_lines");
    setLines(l);
    setRows(await invoke<Snapshot[]>("list_snapshots"));
    setLineId((prev) => prev || (l[0] ? String(l[0].id) : ""));
  }, []);
  useEffect(() => { load().catch((e) => setMsg(String(e))); }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setMsg("");
    try { await fn(); await load(); } catch (e) { setMsg(String(e)); }
  }

  async function save() {
    await act(async () => {
      const args = { lineId: Number(lineId), date, amount };
      if (editId === null) await invoke("add_snapshot", args);
      else await invoke("update_snapshot", { id: editId, ...args });
      setEditId(null);
      setAmount("");
    });
  }

  async function copy() {
    setMsg("");
    setInfo("");
    try {
      const r = await invoke<CopyResult>("copy_balances", { date: copyDate });
      setInfo(
        `Создано черновиков: ${r.created}. Пропущено: уже есть позиция — ${r.skipped_existing}, закрытые (0) — ${r.skipped_closed}, без истории — ${r.skipped_empty}.`,
      );
      await load();
    } catch (e) { setMsg(String(e)); }
  }

  const shown = filterLine ? rows.filter((r) => String(r.line_id) === filterLine) : rows;
  const draftDates = Array.from(new Set(rows.filter((r) => r.is_draft).map((r) => r.date))).sort().reverse();

  

  return (
    <div>
      <h3>Ввод позиций баланса</h3>
      <p><small>Позиция — остаток на счёте на конец указанной даты. Отрицательные суммы разрешены (долги). Чтобы закрыть счёт, внесите нулевой остаток.</small></p>
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}
      {lines.length === 0 ? (
        <p>Сначала добавьте счёт на вкладке «Счета и банки».</p>
      ) : (
        <div style={bar}>
          <select value={lineId} onChange={(e) => setLineId(e.target.value)}>
            {lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); e.target.blur(); }} />
          <AmountInput value={amount} onChange={setAmount} />
          <button onClick={save}>{editId === null ? "Добавить" : "Сохранить"}</button>
          {editId !== null && <button onClick={() => { setEditId(null); setAmount(""); }}>Отмена</button>}
        </div>
      )}

      <div style={bar}>
        <b>Перенос остатков:</b>
        <input type="date" value={copyDate} onChange={(e) => { setCopyDate(e.target.value); e.target.blur(); }} />
        <button onClick={copy}>Скопировать балансы на дату</button>
        <small>
          Копируется последняя известная позиция каждого счёта (закрытые, с нулём, пропускаются).
          Копии — жёлтые черновики: измените сумму или подтвердите. В отчёт черновики не входят.
        </small>
      </div>
      {info && <p><small>{info}</small></p>}
      {draftDates.map((d) => (
        <div key={d} style={{ ...bar, background: DRAFT_BG, padding: "6px 10px", borderRadius: 6 }}>
          <span>Черновики на {d}: {rows.filter((r) => r.is_draft && r.date === d).length}</span>
          <button onClick={() => act(() => invoke("confirm_drafts", { date: d }))}>Подтвердить все</button>
          <DeleteButton text="Удалить черновики" onConfirm={() => { void act(() => invoke("discard_drafts", { date: d })); }} />
        </div>
      ))}

      <div style={bar}>
        <b>Фильтр:</b>
        <select value={filterLine} onChange={(e) => setFilterLine(e.target.value)}>
          <option value="">все счета</option>
          {lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </div>
      <table style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr><th style={cell}>Дата</th><th style={cell}>Счёт</th><th style={cellR}>Сумма</th><th style={cell}>Валюта</th><th style={cell}></th></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id}>
              <td style={cell}>{r.date}</td>
              <td style={cell}>{r.line_label}</td>
              <td style={{ ...cellR, background: r.is_draft ? DRAFT_BG : undefined }} title={r.is_draft ? "Черновик: не подтверждён" : undefined}>
                <Amt a={r.amount} hide={hide} />
              </td>
              <td style={cell}>{r.currency}</td>
              <td style={cell}>
                {r.is_draft && <><button onClick={() => act(() => invoke("confirm_snapshot", { id: r.id }))}>Подтвердить</button>{" "}</>}
                <button onClick={() => { setEditId(r.id); setLineId(String(r.line_id)); setDate(r.date); setAmount(formatInput(whole(r.amount))); }}>Изменить</button>{" "}
                <DeleteButton onConfirm={() => { void act(() => invoke("delete_snapshot", { id: r.id })); }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Счета, банки, владельцы ---------------- */

function DictList(props: {
  items: Item[];
  onRename: (id: number, name: string) => Promise<boolean>;
  onDelete: (id: number) => Promise<boolean>;
}) {
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  

  return (
    <table style={{ borderCollapse: "collapse", marginBottom: 16 }}>
      <tbody>
        {props.items.map((it) => (
          <tr key={it.id}>
            <td style={cell}>
              {editId === it.id ? <input value={editName} onChange={(e) => setEditName(e.target.value)} /> : it.name}
            </td>
            <td style={cell}>
              {editId === it.id ? (
                <>
                  <button onClick={async () => { if (await props.onRename(it.id, editName)) setEditId(null); }}>Сохранить</button>{" "}
                  <button onClick={() => setEditId(null)}>Отмена</button>
                </>
              ) : (
                <>
                  <button onClick={() => { setEditId(it.id); setEditName(it.name); }}>Переименовать</button>{" "}
                  <DeleteButton onConfirm={() => { void props.onDelete(it.id); }} />
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LinesTab() {
  const [owners, setOwners] = useState<Item[]>([]);
  const [banks, setBanks] = useState<Item[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [ownerSel, setOwnerSel] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [region, setRegion] = useState("KZ");
  const [kind, setKind] = useState("bank");
  const [bankSel, setBankSel] = useState("");
  const [newBank, setNewBank] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("KZT");
  
  const [isDeposit, setIsDeposit] = useState(false);
  const [isTax, setIsTax] = useState(false);
  const [interestRate, setInterestRate] = useState("");

  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const os = await invoke<Item[]>("list_owners");
    setOwners(os);
    setBanks(await invoke<Item[]>("list_banks"));
    setLines(await invoke<Line[]>("list_lines"));
    setOwnerSel((prev) => prev || (os[0] ? String(os[0].id) : ""));
  }, []);
  useEffect(() => { load().catch((e) => setMsg(String(e))); }, [load]);

  async function act(fn: () => Promise<unknown>): Promise<boolean> {
    setMsg("");
    try { await fn(); await load(); return true; }
    catch (e) { setMsg(String(e)); return false; }
  }

  function resetForm() {
    setEditId(null);
    setName("");
    setIsDeposit(false);
    setIsTax(false);
    setInterestRate("");
  }

  async function saveLine() {
    await act(async () => {
      if (!ownerSel || ownerSel === "__new__") throw "Выберите владельца";
      const ownerId = Number(ownerSel);
      const bankId = kind === "bank" && bankSel && bankSel !== "__new__" ? Number(bankSel) : null;
      
      const parsedRate = parseFloat(interestRate.replace(",", ".")) || 0;
      const interestRateBps = Math.round(parsedRate * 100);

      if (editId === null) {
        await invoke("add_line", { 
          ownerId, 
          region, 
          kind, 
          bankId, 
          name, 
          currency, 
          isDeposit, 
          interestRateBps,
          isTax
        });
      } else {
        await invoke("update_line", { 
          id: editId, 
          ownerId, 
          region, 
          bankId, 
          name, 
          isDeposit, 
          interestRateBps,
          isTax
        });
      }
      resetForm();
    });
  }

  

  return (
    <div>
      <h3>Счета и банки</h3>
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}

      <h4>{editId === null ? "Новый счёт (строка баланса)" : "Изменить счёт"}</h4>
      <div style={bar}>
        <select value={ownerSel} onChange={(e) => setOwnerSel(e.target.value)}>
          <option value="">— владелец —</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value="__new__">＋ Добавить владельца…</option>
        </select>
        {ownerSel === "__new__" && (
          <>
            <input placeholder="Имя владельца" value={newOwner} onChange={(e) => setNewOwner(e.target.value)} />
            <button
              onClick={() => act(async () => {
                const id = await invoke<number>("add_owner", { name: newOwner });
                setOwnerSel(String(id));
                setNewOwner("");
              })}
            >Добавить владельца</button>
          </>
        )}
        <select value={region} onChange={(e) => setRegion(e.target.value)}>
          {REGIONS.map((r) => <option key={r.v} value={r.v}>{r.t}</option>)}
        </select>
        <select value={kind} disabled={editId !== null} onChange={(e) => setKind(e.target.value)}>
          <option value="bank">Банк</option>
          <option value="cash">Наличные</option>
        </select>
        {kind === "bank" && (
          <select value={bankSel} onChange={(e) => setBankSel(e.target.value)}>
            <option value="">— банк —</option>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="__new__">＋ Добавить банк…</option>
          </select>
        )}
        {kind === "bank" && bankSel === "__new__" && (
          <>
            <input placeholder="Название банка" value={newBank} onChange={(e) => setNewBank(e.target.value)} />
            <button
              onClick={() => act(async () => {
                const id = await invoke<number>("add_bank", { name: newBank });
                setBankSel(String(id));
                setNewBank("");
              })}
            >Добавить банк</button>
          </>
        )}
        <input placeholder="Название строки (Gold, Депозит, Кошелёк…)" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 200 }} />
        <select value={currency} disabled={editId !== null} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={isTax} onChange={(e) => setIsTax(e.target.checked)} /> Налоги
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={isDeposit} onChange={(e) => setIsDeposit(e.target.checked)} /> Депозит
        </label>
        {isDeposit && (
          <input 
            placeholder="Ставка % (например, 14.5)" 
            value={interestRate} 
            onChange={(e) => setInterestRate(e.target.value)} 
            style={{ width: 140 }} 
          />
        )}

        <button onClick={saveLine}>{editId === null ? "Добавить" : "Сохранить"}</button>
        {editId !== null && <button onClick={resetForm}>Отмена</button>}
      </div>

      <table style={{ borderCollapse: "collapse", marginBottom: 24 }}>
        <thead>
          <tr>
            <th style={cell}>Владелец</th><th style={cell}>Регион</th><th style={cell}>Где лежат</th>
            <th style={cell}>Строка</th><th style={cell}>Валюта</th><th style={cell}>Тип / Ставка</th><th style={cell}></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td style={cell}>{l.owner || "—"}</td>
              <td style={cell}>{regionName(l.region)}</td>
              <td style={cell}>{l.bank_name ?? "Наличные"}</td>
              <td style={cell}>{l.name}</td>
              <td style={cell}>{l.currency}</td>
              <td style={cell}>
                {l.is_tax && <span style={{ marginRight: 6, padding: "2px 6px", background: "#eee", borderRadius: 4, fontSize: "11px" }}>Налог</span>}
                {l.is_deposit ? `Депозит (${(l.interest_rate_bps / 100).toFixed(2)}%)` : "Обычный"}
              </td>
              <td style={cell}>
                <button
                  onClick={() => {
                    setEditId(l.id); 
                    setOwnerSel(l.owner_id ? String(l.owner_id) : ""); 
                    setRegion(l.region);
                    setKind(l.kind); 
                    setBankSel(l.bank_id ? String(l.bank_id) : ""); 
                    setName(l.name); 
                    setCurrency(l.currency);
                    setIsDeposit(l.is_deposit);
                    setIsTax(l.is_tax);
                    setInterestRate(l.is_deposit ? (l.interest_rate_bps / 100).toString() : "");
                  }}
                >Изменить</button>{" "}
                <DeleteButton text="Удалить со всей историей" onConfirm={() => { void act(() => invoke("delete_line", { id: l.id })); }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 48, flexWrap: "wrap" }}>
        <div>
          <h4>Владельцы</h4>
          <DictList
            items={owners}
            onRename={(id, n) => act(() => invoke("rename_owner", { id, name: n }))}
            onDelete={(id) => act(() => invoke("delete_owner", { id }))}
          />
        </div>
        <div>
          <h4>Банки</h4>
          <DictList
            items={banks}
            onRename={(id, n) => act(() => invoke("rename_bank", { id, name: n }))}
            onDelete={(id) => act(() => invoke("delete_bank", { id }))}
          />
        </div>
      </div>
      <p><small>Владельца и банк можно удалить, только если нет счетов, которые их используют.</small></p>
    </div>
  );
}
