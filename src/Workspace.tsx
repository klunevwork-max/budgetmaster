import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const CURRENCIES = ["KZT", "USD", "EUR", "RUB"];

type Snapshot = { id: number; date: string; currency: string; amount: string };
type Category = { id: number; name: string; type: string; is_interest: boolean };
type Operation = {
  id: number; date: string; type: string; currency: string; amount: string;
  category_id: number | null; category_name: string | null; comment: string | null;
};
type Fmt = { fmt: (a: string) => string };

const today = () => new Date().toLocaleDateString("sv-SE");
const cell = { padding: "4px 8px", borderBottom: "1px solid #ddd", textAlign: "left" as const };
const bar = { display: "flex", gap: 8, flexWrap: "wrap" as const, marginBottom: 12, alignItems: "center" };

function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <>
      <button onClick={() => { setArmed(false); onConfirm(); }}>Точно?</button>
      <button onClick={() => setArmed(false)}>Нет</button>
    </>
  ) : (
    <button onClick={() => setArmed(true)}>Удалить</button>
  );
}

function Snapshots({ fmt }: Fmt) {
  const [rows, setRows] = useState<Snapshot[]>([]);
  const [date, setDate] = useState(today());
  const [currency, setCurrency] = useState("KZT");
  const [amount, setAmount] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setRows(await invoke<Snapshot[]>("list_snapshots"));
  }, []);
  useEffect(() => { load().catch((e) => setMsg(String(e))); }, [load]);

  async function save() {
    setMsg("");
    try {
      if (editId === null) await invoke("add_snapshot", { date, currency, amount });
      else await invoke("update_snapshot", { id: editId, date, currency, amount });
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

  return (
    <div>
      <h3>Позиции баланса</h3>
      <p><small>Позиция — баланс по валюте на конец указанной даты. Отрицательные суммы разрешены (долги).</small></p>
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}
      <div style={bar}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input placeholder="Сумма" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button onClick={save}>{editId === null ? "Добавить" : "Сохранить"}</button>
        {editId !== null && <button onClick={() => { setEditId(null); setAmount(""); }}>Отмена</button>}
      </div>
      <table style={{ borderCollapse: "collapse" }}>
        <thead><tr><th style={cell}>Дата</th><th style={cell}>Валюта</th><th style={cell}>Сумма</th><th style={cell}></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={cell}>{r.date}</td>
              <td style={cell}>{r.currency}</td>
              <td style={cell}>{fmt(r.amount)}</td>
              <td style={cell}>
                <button onClick={() => { setEditId(r.id); setDate(r.date); setCurrency(r.currency); setAmount(r.amount); }}>Изменить</button>{" "}
                <DeleteButton onConfirm={() => remove(r.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Categories() {
  const [rows, setRows] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState("expense");
  const [isInterest, setIsInterest] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setRows(await invoke<Category[]>("list_categories"));
  }, []);
  useEffect(() => { load().catch((e) => setMsg(String(e))); }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setMsg("");
    try { await fn(); await load(); } catch (e) { setMsg(String(e)); }
  }

  return (
    <div>
      <h3>Категории</h3>
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}
      <div style={bar}>
        <input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="expense">Расход</option>
          <option value="income">Доход</option>
        </select>
        <label><input type="checkbox" checked={isInterest} onChange={(e) => setIsInterest(e.target.checked)} /> «проценты»</label>
        <button onClick={() => act(async () => { await invoke("add_category", { name, catType: type, isInterest }); setName(""); })}>Добавить</button>
      </div>
      <table style={{ borderCollapse: "collapse" }}>
        <thead><tr><th style={cell}>Название</th><th style={cell}>Тип</th><th style={cell}>«Проценты»</th><th style={cell}></th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td style={cell}>{c.name}</td>
              <td style={cell}>{c.type === "income" ? "Доход" : "Расход"}</td>
              <td style={cell}>
                <input
                  type="checkbox"
                  checked={c.is_interest}
                  onChange={(e) => act(() => invoke("update_category", { id: c.id, name: c.name, catType: c.type, isInterest: e.target.checked }))}
                />
              </td>
              <td style={cell}><DeleteButton onConfirm={() => act(() => invoke("delete_category", { id: c.id }))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Operations({ fmt }: Fmt) {
  const [rows, setRows] = useState<Operation[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fType, setFType] = useState("");
  const [fCat, setFCat] = useState("");
  const [date, setDate] = useState(today());
  const [opType, setOpType] = useState("expense");
  const [currency, setCurrency] = useState("KZT");
  const [amount, setAmount] = useState("");
  const [catId, setCatId] = useState("");
  const [comment, setComment] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setRows(await invoke<Operation[]>("list_operations", {
      dateFrom: fFrom, dateTo: fTo, opType: fType, categoryId: fCat ? Number(fCat) : null,
    }));
  }, [fFrom, fTo, fType, fCat]);
  useEffect(() => { load().catch((e) => setMsg(String(e))); }, [load]);
  useEffect(() => {
    invoke<Category[]>("list_categories").then(setCats).catch((e) => setMsg(String(e)));
  }, []);

  async function save() {
    setMsg("");
    const args = { date, opType, currency, amount, categoryId: catId ? Number(catId) : null, comment };
    try {
      if (editId === null) await invoke("add_operation", args);
      else await invoke("update_operation", { id: editId, ...args });
      setEditId(null);
      setAmount("");
      setComment("");
      await load();
    } catch (e) { setMsg(String(e)); }
  }

  async function remove(id: number) {
    setMsg("");
    try { await invoke("delete_operation", { id }); await load(); }
    catch (e) { setMsg(String(e)); }
  }

  return (
    <div>
      <h3>Операции</h3>
      <p><small>Операции на баланс не влияют — они нужны для анализа движения баланса в отчёте.</small></p>
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}
      <div style={bar}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select value={opType} onChange={(e) => { setOpType(e.target.value); setCatId(""); }}>
          <option value="expense">Расход</option>
          <option value="income">Доход</option>
        </select>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input placeholder="Сумма" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <select value={catId} onChange={(e) => setCatId(e.target.value)}>
          <option value="">— без категории —</option>
          {cats.filter((c) => c.type === opType).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input placeholder="Комментарий" value={comment} onChange={(e) => setComment(e.target.value)} />
        <button onClick={save}>{editId === null ? "Добавить" : "Сохранить"}</button>
        {editId !== null && <button onClick={() => { setEditId(null); setAmount(""); setComment(""); }}>Отмена</button>}
      </div>
      <div style={bar}>
        <b>Фильтры:</b>
        <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
        <select value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">все типы</option>
          <option value="expense">Расходы</option>
          <option value="income">Доходы</option>
        </select>
        <select value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="">все категории</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <table style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={cell}>Дата</th><th style={cell}>Сумма</th><th style={cell}>Валюта</th>
            <th style={cell}>Категория</th><th style={cell}>Комментарий</th><th style={cell}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td style={cell}>{o.date}</td>
              <td style={cell}>{o.type === "income" ? "+" : "−"}{fmt(o.amount)}</td>
              <td style={cell}>{o.currency}</td>
              <td style={cell}>{o.category_name ?? "—"}</td>
              <td style={cell}>{o.comment ?? ""}</td>
              <td style={cell}>
                <button
                  onClick={() => {
                    setEditId(o.id); setDate(o.date); setOpType(o.type); setCurrency(o.currency);
                    setAmount(o.amount); setCatId(o.category_id ? String(o.category_id) : ""); setComment(o.comment ?? "");
                  }}
                >Изменить</button>{" "}
                <DeleteButton onConfirm={() => remove(o.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Main() {
  const [tab, setTab] = useState<"snap" | "ops" | "cats">("snap");
  const [hide, setHide] = useState(false);
  const fmt = (a: string) => (hide ? "••••" : a);
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={bar}>
        <button disabled={tab === "snap"} onClick={() => setTab("snap")}>Позиции баланса</button>
        <button disabled={tab === "ops"} onClick={() => setTab("ops")}>Операции</button>
        <button disabled={tab === "cats"} onClick={() => setTab("cats")}>Категории</button>
        <button onClick={() => setHide(!hide)}>{hide ? "Показать суммы" : "Скрыть суммы"}</button>
      </div>
      {tab === "snap" && <Snapshots fmt={fmt} />}
      {tab === "ops" && <Operations fmt={fmt} />}
      {tab === "cats" && <Categories />}
    </div>
  );
}
