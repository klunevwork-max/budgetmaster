import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Amt, AmountInput, DeleteButton, bar, cell, cellR, formatInput, today } from "./ui";

const CURRENCIES = ["KZT", "USD", "EUR", "RUB"];
const REGIONS = [{ v: "KZ", t: "Казахстан" }, { v: "RU", t: "Россия" }];
const regionName = (v: string) => REGIONS.find((r) => r.v === v)?.t ?? v;

type Item = { id: number; name: string };
type Line = {
  id: number; owner_id: number | null; owner: string; region: string; kind: string;
  bank_id: number | null; bank_name: string | null; name: string; currency: string; label: string;
};
type Snapshot = { id: number; line_id: number; line_label: string; date: string; currency: string; amount: string };
type LineBalance = {
  line_id: number; owner: string; region_name: string; place: string; name: string;
  currency: string; date: string | null; amount: string | null;
};
type Total = { currency: string; amount: string };
type Balances = { rows: LineBalance[]; totals: Total[] };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

/* ---------------- Актуальные балансы ---------------- */

export function CurrentTab({ hide }: { hide: boolean }) {
  const [owners, setOwners] = useState<Item[]>([]);
  const [asOf, setAsOf] = useState(today());
  const [ownerId, setOwnerId] = useState("");
  const [region, setRegion] = useState("");
  const [hideZero, setHideZero] = useState(true);
  const [data, setData] = useState<Balances>({ rows: [], totals: [] });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    invoke<Item[]>("list_owners").then(setOwners).catch((e) => setMsg(String(e)));
  }, []);

  useEffect(() => {
    invoke<Balances>("current_balances", {
      asOf, ownerId: ownerId ? Number(ownerId) : null, region, hideZero,
    })
      .then((d) => { setData(d); setMsg(""); })
      .catch((e) => setMsg(String(e)));
  }, [asOf, ownerId, region, hideZero]);

  return (
    <div>
      <h3>Актуальные балансы</h3>
      <p><small>Последняя известная позиция по каждому счёту на выбранную дату. Дата старше 31 дня подсвечивается.</small></p>
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}
      <div style={bar}>
        <label>На дату: <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
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
            <th style={cell}>Строка</th><th style={cell}>Валюта</th><th style={cellR}>Остаток</th><th style={cell}>Актуально на</th>
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
                <td style={cell}>{r.currency}</td>
                <td style={cellR}>{r.amount === null ? "—" : <Amt a={r.amount} hide={hide} />}</td>
                <td style={{ ...cell, color: stale ? "#b60" : undefined }}>{r.date ?? "нет данных"}{stale ? " (давно)" : ""}</td>
              </tr>
            );
          })}
          {data.rows.length === 0 && (
            <tr><td style={cell} colSpan={7}>Нет счетов по выбранным условиям. Добавьте их на вкладке «Счета и банки».</td></tr>
          )}
        </tbody>
      </table>

      <h4>Итого по валютам</h4>
      <table style={{ borderCollapse: "collapse" }}>
        <tbody>
          {data.totals.map((t) => (
            <tr key={t.currency}>
              <td style={cell}><b>{t.currency}</b></td>
              <td style={cellR}><b><Amt a={t.amount} hide={hide} /></b></td>
            </tr>
          ))}
          {data.totals.length === 0 && <tr><td style={cell}>—</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Ввод позиций ---------------- */

export function Snapshots({ hide }: { hide: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [rows, setRows] = useState<Snapshot[]>([]);
  const [lineId, setLineId] = useState("");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [filterLine, setFilterLine] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const l = await invoke<Line[]>("list_lines");
    setLines(l);
    setRows(await invoke<Snapshot[]>("list_snapshots"));
    setLineId((prev) => prev || (l[0] ? String(l[0].id) : ""));
  }, []);
  useEffect(() => { load().catch((e) => setMsg(String(e))); }, [load]);

  async function save() {
    setMsg("");
    try {
      const args = { lineId: Number(lineId), date, amount };
      if (editId === null) await invoke("add_snapshot", args);
      else await invoke("update_snapshot", { id: editId, ...args });
      setEditId(null);
      setAmount("");
      await load();
    } catch (e) { setMsg(String(e)); }
  }

  async function remove(id: number) {
    setMsg("");
    try { await invoke("delete_snapshot", { id }); await load(); }
    catch (e) { setMsg(String(e)); }
  }

  const shown = filterLine ? rows.filter((r) => String(r.line_id) === filterLine) : rows;

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
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <AmountInput value={amount} onChange={setAmount} />
          <button onClick={save}>{editId === null ? "Добавить" : "Сохранить"}</button>
          {editId !== null && <button onClick={() => { setEditId(null); setAmount(""); }}>Отмена</button>}
        </div>
      )}
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
              <td style={cellR}><Amt a={r.amount} hide={hide} /></td>
              <td style={cell}>{r.currency}</td>
              <td style={cell}>
                <button onClick={() => { setEditId(r.id); setLineId(String(r.line_id)); setDate(r.date); setAmount(formatInput(r.amount)); }}>Изменить</button>{" "}
                <DeleteButton onConfirm={() => remove(r.id)} />
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

  function resetForm() { setEditId(null); setName(""); }

  async function saveLine() {
    await act(async () => {
      if (!ownerSel || ownerSel === "__new__") throw "Выберите владельца";
      const ownerId = Number(ownerSel);
      const bankId = kind === "bank" && bankSel && bankSel !== "__new__" ? Number(bankSel) : null;
      if (editId === null) await invoke("add_line", { ownerId, region, kind, bankId, name, currency });
      else await invoke("update_line", { id: editId, ownerId, region, bankId, name });
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
        <input placeholder="Название строки (Gold, Депозит, Кошелёк…)" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 260 }} />
        <select value={currency} disabled={editId !== null} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button onClick={saveLine}>{editId === null ? "Добавить" : "Сохранить"}</button>
        {editId !== null && <button onClick={resetForm}>Отмена</button>}
      </div>

      <table style={{ borderCollapse: "collapse", marginBottom: 24 }}>
        <thead>
          <tr>
            <th style={cell}>Владелец</th><th style={cell}>Регион</th><th style={cell}>Где лежат</th>
            <th style={cell}>Строка</th><th style={cell}>Валюта</th><th style={cell}></th>
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
                <button
                  onClick={() => {
                    setEditId(l.id); setOwnerSel(l.owner_id ? String(l.owner_id) : ""); setRegion(l.region);
                    setKind(l.kind); setBankSel(l.bank_id ? String(l.bank_id) : ""); setName(l.name); setCurrency(l.currency);
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
