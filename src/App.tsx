import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Workspace from "./Workspace";

type RecKind = "code" | "question" | "none";
type RecInfo = { kind: string; question: string | null } | null;
type AccountInfo = { name: string; has_password: boolean };

const page = { 
  padding: "40px 24px", 
  fontFamily: "system-ui, -apple-system, sans-serif", 
  color: "#111827", 
  background: "#f3f4f6", 
  minHeight: "100vh", 
  colorScheme: "light" as const,
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center"
};

const cardStyle = {
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: "16px",
  padding: "32px",
  width: "100%",
  maxWidth: "420px",
  boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)",
  display: "flex",
  flexDirection: "column" as const,
  gap: "16px"
};

const inputStyle = {
  padding: "10px 14px",
  borderRadius: "8px",
  border: "1px solid #d1d5db",
  fontSize: "15px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box" as const
};

const btnPrimary = {
  background: "#2563eb",
  color: "#ffffff",
  border: "none",
  borderRadius: "8px",
  padding: "10px 16px",
  fontSize: "15px",
  fontWeight: 500,
  cursor: "pointer",
  transition: "background 0.2s"
};

const btnSecondary = {
  background: "#f3f4f6",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: "8px",
  padding: "8px 14px",
  fontSize: "14px",
  cursor: "pointer"
};

const headerBar = {
  position: "sticky" as const, top: 0, zIndex: 20, background: "#fff", height: 60, boxSizing: "border-box" as const,
  display: "flex", justifyContent: "space-between", alignItems: "center",
  margin: "-40px -24px 24px -24px", padding: "0 24px", borderBottom: "1px solid #e5e7eb",
  boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)"
};

const gear = { fontSize: 18, lineHeight: 1, padding: "6px 12px", cursor: "pointer", background: "none", border: "1px solid #d1d5db", borderRadius: "6px" };

const panel = {
  position: "fixed" as const, top: 70, right: 24, width: 440, maxHeight: "80vh", overflowY: "auto" as const,
  background: "#fff", border: "1px solid #e5e7eb", borderRadius: "12px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
  padding: 24, zIndex: 30,
};

function RecoveryChooser(props: {
  allowNone: boolean;
  kind: RecKind; setKind: (k: RecKind) => void;
  question: string; setQuestion: (s: string) => void;
  answer: string; setAnswer: (s: string) => void;
}) {
  const { allowNone, kind, setKind, question, setQuestion, answer, setAnswer } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "#f9fafb", padding: 14, borderRadius: 8, border: "1px solid #e5e7eb" }}>
      <b style={{ fontSize: 14, color: "#374151" }}>Восстановление доступа</b>
      <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="radio" checked={kind === "code"} onChange={() => setKind("code")} /> Код восстановления (рекомендуется)
      </label>
      <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="radio" checked={kind === "question"} onChange={() => setKind("question")} /> Контрольный вопрос
      </label>
      {allowNone && (
        <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="radio" checked={kind === "none"} onChange={() => setKind("none")} /> Без восстановления
        </label>
      )}
      {kind === "code" && <small style={{ color: "#6b7280" }}>Будет сгенерирован код. Сохраните его в менеджер паролей или на бумагу — он показывается один раз.</small>}
      {kind === "question" && (
        <>
          <input placeholder="Ваш вопрос" value={question} onChange={(e) => setQuestion(e.target.value)} style={inputStyle} />
          <input placeholder="Ответ (от 12 символов)" value={answer} onChange={(e) => setAnswer(e.target.value)} style={inputStyle} />
          <small style={{ color: "#d97706" }}>Слабее кода: ответ, который можно угадать, снижает защиту данных.</small>
        </>
      )}
      {kind === "none" && <small style={{ color: "#d97706" }}>При утере пароля данные будут потеряны безвозвратно.</small>}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [view, setView] = useState<"login" | "create" | "forgot">("login");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [noPw, setNoPw] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [kind, setKind] = useState<RecKind>("code");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [secret, setSecret] = useState("");
  const [recInfo, setRecInfo] = useState<RecInfo | undefined>(undefined);
  const [codeToShow, setCodeToShow] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function refresh() {
    const sessionUser = await invoke<string | null>("session_info");
    const accs = await invoke<AccountInfo[]>("list_accounts");
    setUser(sessionUser);
    setAccounts(accs);

    if (!sessionUser && accs.length > 0 && !name) {
      const lastUser = localStorage.getItem("budgetmaster_last_user");
      if (lastUser && accs.some(a => a.name === lastUser)) {
        setName(lastUser);
      } else {
        setName(accs[0].name);
      }
    }
  }

  useEffect(() => { refresh().catch((e) => setMsg(String(e))); }, []);

  function clearSecrets() {
    setPassword(""); setOldPw(""); setNewPw(""); setAnswer(""); setSecret("");
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg("");
    try { 
      await fn(); 
      setMsg(ok); 
      if (user) {
        localStorage.setItem("budgetmaster_last_user", user);
      }
    } catch (e) { setMsg(String(e)); }
    clearSecrets();
    await refresh().catch(() => {});
  }

  async function loadRecInfo(n: string) {
    setName(n);
    setRecInfo(undefined);
    if (!n) return;
    try { setRecInfo(await invoke<RecInfo>("recovery_info", { name: n })); }
    catch (e) { setMsg(String(e)); }
  }

  const selected = accounts.find((a) => a.name === name);
  const needsPw = !selected || selected.has_password;
  const me = accounts.find((a) => a.name === user);
  const hasPw = me?.has_password ?? true;

  if (codeToShow) {
    return (
      <div style={page}>
        <div style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: 22, color: "#111827" }}>Код восстановления</h2>
          <p style={{ fontSize: 22, letterSpacing: 2, fontFamily: "monospace", background: "#f3f4f6", padding: "12px", borderRadius: 8, textAlign: "center", margin: 0 }}>{codeToShow}</p>
          <p style={{ fontSize: 14, color: "#4b5563", margin: 0 }}>Сохраните его сейчас (в менеджер паролей или на бумагу). Он <b>не будет показан снова</b>.</p>
          <button style={btnPrimary} onClick={() => setCodeToShow(null)}>Я сохранил код</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...page, justifyContent: user ? "flex-start" : "center" }}>
      {user && (
        <div style={headerBar}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#111827" }}>BudgetMaster</h2>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 14, color: "#4b5563" }}>{user}{hasPw ? "" : " (без пароля)"}</span>
            <button title="Настройки учётки" style={gear} onClick={() => setSettingsOpen(!settingsOpen)}>⚙</button>
            <button style={{ ...btnSecondary, padding: "6px 12px" }} onClick={() => { setSettingsOpen(false); run(() => invoke("logout"), "Вы вышли"); }}>Выйти</button>
          </div>
        </div>
      )}
      {msg && <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fee2e2", color: "#b91c1c", borderRadius: 8, fontSize: 14, width: "100%", maxWidth: 420, boxSizing: "border-box" }}>{msg}</div>}

      {!user && view === "login" && (
        <div style={cardStyle}>
          <div style={{ textAlign: "center", marginBottom: 8 }}>
            <h2 style={{ margin: "0 0 6px 0", fontSize: 24, color: "#111827" }}>BudgetMaster</h2>
            <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>Войдите в свою учетную запись</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <select value={name} onChange={(e) => { setName(e.target.value); localStorage.setItem("budgetmaster_last_user", e.target.value); }} style={inputStyle}>
              <option value="">— выберите учётку —</option>
              {accounts.map((a) => (
                <option key={a.name} value={a.name}>{a.name}{a.has_password ? "" : " (без пароля)"}</option>
              ))}
            </select>
            {needsPw && (
              <input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} onKeyDown={(e) => { if (e.key === 'Enter' && name) run(() => invoke("login", { name, password: needsPw ? password : "" }), ""); }} />
            )}
            <button style={{ ...btnPrimary, marginTop: 4 }} disabled={!name} onClick={() => { localStorage.setItem("budgetmaster_last_user", name); run(() => invoke("login", { name, password: needsPw ? password : "" }), ""); }}>Войти</button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              {needsPw ? (
                <button style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, padding: 0 }} onClick={() => { setMsg(""); setView("forgot"); loadRecInfo(name); }}>Забыли пароль?</button>
              ) : (
                <button style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, padding: 0 }} onClick={() => { setMsg(""); setView("forgot"); loadRecInfo(name); }}>Восстановить доступ</button>
              )}
              <button style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, padding: 0 }} onClick={() => { setMsg(""); setName(""); setView("create"); }}>Создать учётку</button>
            </div>
          </div>
        </div>
      )}

      {!user && view === "create" && (
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 8px 0", fontSize: 20, color: "#111827" }}>Создать учётку</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={noPw}
                onChange={(e) => { setNoPw(e.target.checked); if (e.target.checked && kind === "none") setKind("code"); }}
              /> Без пароля (вход одним кликом)
            </label>
            {noPw ? (
              <small style={{ color: "#d97706", lineHeight: 1.4 }}>
                Данные зашифрованы, ключ хранится в хранилище ОС. Любой в вашей сессии сможет открыть базу.
              </small>
            ) : (
              <input type="password" placeholder="Пароль (≥ 8 символов)" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
            )}
            <RecoveryChooser allowNone={!noPw} {...{ kind, setKind, question, setQuestion, answer, setAnswer }} />
            <button
              style={btnPrimary}
              onClick={() =>
                run(async () => {
                  const code = await invoke<string | null>("create_account", {
                    name, password: noPw ? null : password, recoveryKind: kind, question, answer,
                  });
                  if (code) setCodeToShow(code);
                  setView("login");
                }, "Учётка создана")
              }
            >Создать</button>
            <button style={btnSecondary} onClick={() => setView("login")}>Назад</button>
          </div>
        </div>
      )}

      {!user && view === "forgot" && (
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 8px 0", fontSize: 20, color: "#111827" }}>Восстановление доступа</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <select value={name} onChange={(e) => loadRecInfo(e.target.value)} style={inputStyle}>
              <option value="">— выберите учётку —</option>
              {accounts.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
            {recInfo === null && name && <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>Для этой учётки восстановление не настроено.</p>}
            {recInfo && (
              <>
                {recInfo.kind === "question"
                  ? <p style={{ fontSize: 14, margin: 0 }}>Вопрос: <b>{recInfo.question}</b></p>
                  : <p style={{ fontSize: 14, margin: 0 }}>Введите код восстановления.</p>}
                <input placeholder={recInfo.kind === "question" ? "Ответ" : "Код восстановления"} value={secret} onChange={(e) => setSecret(e.target.value)} style={inputStyle} />
                <input type="password" placeholder="Новый пароль (пусто — без пароля)" value={newPw} onChange={(e) => setNewPw(e.target.value)} style={inputStyle} />
                <button style={btnPrimary} onClick={() => run(() => invoke("recover_account", { name, secret, newPassword: newPw }), "Доступ восстановлен")}>Восстановить</button>
              </>
            )}
            <button style={btnSecondary} onClick={() => setView("login")}>Назад</button>
          </div>
        </div>
      )}

      {user && <Workspace />}

      {user && settingsOpen && (
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <b style={{ fontSize: 16 }}>Учётка «{user}»</b>
            <button onClick={() => setSettingsOpen(false)} style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {hasPw ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontWeight: 500, fontSize: 14 }}>Сменить пароль</span>
                  <input type="password" placeholder="Текущий пароль" value={oldPw} onChange={(e) => setOldPw(e.target.value)} style={inputStyle} />
                  <input type="password" placeholder="Новый пароль" value={newPw} onChange={(e) => setNewPw(e.target.value)} style={inputStyle} />
                  <button style={btnSecondary} onClick={() => run(() => invoke("change_password", { oldPassword: oldPw, newPassword: newPw }), "Пароль изменён")}>Сменить пароль</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontWeight: 500, fontSize: 14 }}>Убрать пароль</span>
                  <input type="password" placeholder="Текущий пароль" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
                  <button style={btnSecondary} onClick={() => run(() => invoke("remove_password", { password }), "Пароль убран")}>Убрать пароль</button>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontWeight: 500, fontSize: 14 }}>Задать пароль</span>
                <input type="password" placeholder="Новый пароль (≥ 8 символов)" value={newPw} onChange={(e) => setNewPw(e.target.value)} style={inputStyle} />
                <button style={btnSecondary} onClick={() => run(() => invoke("change_password", { oldPassword: "", newPassword: newPw }), "Пароль задан")}>Задать пароль</button>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontWeight: 500, fontSize: 14 }}>Восстановление</span>
              {hasPw && <input type="password" placeholder="Текущий пароль" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />}
              <RecoveryChooser allowNone={hasPw} {...{ kind, setKind, question, setQuestion, answer, setAnswer }} />
              <button
                style={btnSecondary}
                onClick={() =>
                  run(async () => {
                    const code = await invoke<string | null>("set_recovery", {
                      password: hasPw ? password : "", recoveryKind: kind, question, answer,
                    });
                    if (code) setCodeToShow(code);
                  }, "Восстановление настроено")
                }
              >Сохранить настройки восстановления</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
