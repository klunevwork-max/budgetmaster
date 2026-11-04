import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Workspace from "./Workspace";

type RecKind = "code" | "question" | "none";
type RecInfo = { kind: string; question: string | null } | null;
type AccountInfo = { name: string; has_password: boolean };

const box = { display: "flex", flexDirection: "column" as const, gap: 8, maxWidth: 400, marginBottom: 24 };
const page = { padding: 24, fontFamily: "system-ui, sans-serif", color: "#111", background: "#fff", minHeight: "100vh", colorScheme: "light" as const };
const headerBar = {
  position: "sticky" as const, top: 0, zIndex: 20, background: "#fff", height: 56, boxSizing: "border-box" as const,
  display: "flex", justifyContent: "space-between", alignItems: "center",
  margin: "-24px -24px 0", padding: "0 24px", borderBottom: "1px solid #ddd",
};
const gear = { fontSize: 18, lineHeight: 1, padding: "4px 10px", cursor: "pointer" };
const panel = {
  position: "fixed" as const, top: 64, right: 16, width: 440, maxHeight: "80vh", overflowY: "auto" as const,
  background: "#fff", border: "1px solid #bbb", borderRadius: 8, boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
  padding: 16, zIndex: 30,
};

function RecoveryChooser(props: {
  allowNone: boolean;
  kind: RecKind; setKind: (k: RecKind) => void;
  question: string; setQuestion: (s: string) => void;
  answer: string; setAnswer: (s: string) => void;
}) {
  const { allowNone, kind, setKind, question, setQuestion, answer, setAnswer } = props;
  return (
    <div style={box}>
      <b>Восстановление доступа</b>
      <label><input type="radio" checked={kind === "code"} onChange={() => setKind("code")} /> Код восстановления (рекомендуется)</label>
      <label><input type="radio" checked={kind === "question"} onChange={() => setKind("question")} /> Контрольный вопрос</label>
      {allowNone && (
        <label><input type="radio" checked={kind === "none"} onChange={() => setKind("none")} /> Без восстановления</label>
      )}
      {kind === "code" && <small>Будет сгенерирован код. Сохраните его в менеджер паролей или на бумагу — он показывается один раз.</small>}
      {kind === "question" && (
        <>
          <input placeholder="Ваш вопрос" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <input placeholder="Ответ (от 12 символов, лучше фраза)" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <small style={{ color: "#b60" }}>Слабее кода: ответ, который можно угадать или найти о вас, снижает защиту всех данных.</small>
        </>
      )}
      {kind === "none" && <small style={{ color: "#b60" }}>При утере пароля данные будут потеряны безвозвратно.</small>}
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
    setUser(await invoke<string | null>("session_info"));
    setAccounts(await invoke<AccountInfo[]>("list_accounts"));
  }

  useEffect(() => { refresh().catch((e) => setMsg(String(e))); }, []);

  function clearSecrets() {
    setPassword(""); setOldPw(""); setNewPw(""); setAnswer(""); setSecret("");
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg("");
    try { await fn(); setMsg(ok); } catch (e) { setMsg(String(e)); }
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
        <h2>Код восстановления</h2>
        <p style={{ fontSize: 24, letterSpacing: 2, fontFamily: "monospace" }}>{codeToShow}</p>
        <p>Сохраните его сейчас (менеджер паролей или бумага). Он <b>не будет показан снова</b>.</p>
        <button onClick={() => setCodeToShow(null)}>Я сохранил код</button>
      </div>
    );
  }

  return (
    <div style={page}>
      {!user ? (
        <h2>BudgetMaster</h2>
      ) : (
        <div style={headerBar}>
          <h2 style={{ margin: 0 }}>BudgetMaster</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>{user}{hasPw ? "" : " (без пароля)"}</span>
            <button title="Настройки учётки" style={gear} onClick={() => setSettingsOpen(!settingsOpen)}>⚙</button>
            <button onClick={() => { setSettingsOpen(false); run(() => invoke("logout"), "Вы вышли"); }}>Выйти</button>
          </div>
        </div>
      )}
      {msg && <p style={{ color: "#b00" }}>{msg}</p>}

      {!user && view === "login" && (
        <div style={box}>
          <h3>Вход</h3>
          <select value={name} onChange={(e) => setName(e.target.value)}>
            <option value="">— выберите учётку —</option>
            {accounts.map((a) => (
              <option key={a.name} value={a.name}>{a.name}{a.has_password ? "" : " (без пароля)"}</option>
            ))}
          </select>
          {needsPw && (
            <input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
          <button disabled={!name} onClick={() => run(() => invoke("login", { name, password: needsPw ? password : "" }), "Вход выполнен")}>Войти</button>
          {needsPw && <button onClick={() => { setMsg(""); setView("forgot"); loadRecInfo(name); }}>Забыли пароль?</button>}
          {!needsPw && <button onClick={() => { setMsg(""); setView("forgot"); loadRecInfo(name); }}>Не открывается? Восстановить доступ</button>}
          <button onClick={() => { setMsg(""); setName(""); setView("create"); }}>Создать учётку</button>
        </div>
      )}

      {!user && view === "create" && (
        <div style={box}>
          <h3>Создать учётку</h3>
          <input placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} />
          <label>
            <input
              type="checkbox"
              checked={noPw}
              onChange={(e) => { setNoPw(e.target.checked); if (e.target.checked && kind === "none") setKind("code"); }}
            /> Без пароля (вход одним кликом)
          </label>
          {noPw ? (
            <small style={{ color: "#b60" }}>
              Данные зашифрованы, ключ хранится в хранилище ОС. Любой, кто работает в вашей сессии ОС, сможет открыть базу.
              Копия файлов на другом компьютере без кода восстановления не откроется, поэтому восстановление обязательно.
            </small>
          ) : (
            <input type="password" placeholder="Пароль (≥ 8 символов)" value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
          <RecoveryChooser allowNone={!noPw} {...{ kind, setKind, question, setQuestion, answer, setAnswer }} />
          <button
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
          <button onClick={() => setView("login")}>Назад</button>
        </div>
      )}

      {!user && view === "forgot" && (
        <div style={box}>
          <h3>Восстановление доступа</h3>
          <select value={name} onChange={(e) => loadRecInfo(e.target.value)}>
            <option value="">— выберите учётку —</option>
            {accounts.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
          </select>
          {recInfo === null && name && <p>Для этой учётки восстановление не настроено.</p>}
          {recInfo && (
            <>
              {recInfo.kind === "question"
                ? <p>Вопрос: <b>{recInfo.question}</b></p>
                : <p>Введите код восстановления.</p>}
              <input placeholder={recInfo.kind === "question" ? "Ответ" : "Код восстановления"} value={secret} onChange={(e) => setSecret(e.target.value)} />
              <input type="password" placeholder="Новый пароль (пусто — вход без пароля)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              <button onClick={() => run(() => invoke("recover_account", { name, secret, newPassword: newPw }), "Доступ восстановлен, вход выполнен")}>Восстановить</button>
            </>
          )}
          <button onClick={() => setView("login")}>Назад</button>
        </div>
      )}

      {user && <Workspace />}

      {user && settingsOpen && (
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <b>Учётка «{user}»: пароль и восстановление</b>
            <button onClick={() => setSettingsOpen(false)}>✕</button>
          </div>
          {hasPw ? (
            <>
              <div style={box}>
                <h3>Сменить пароль</h3>
                <input type="password" placeholder="Текущий пароль" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
                <input type="password" placeholder="Новый пароль" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                <button onClick={() => run(() => invoke("change_password", { oldPassword: oldPw, newPassword: newPw }), "Пароль изменён")}>Сменить</button>
              </div>
              <div style={box}>
                <h3>Убрать пароль (вход без пароля)</h3>
                <small>Нужно настроенное восстановление. Подтвердите текущим паролем.</small>
                <input type="password" placeholder="Текущий пароль" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button onClick={() => run(() => invoke("remove_password", { password }), "Пароль убран")}>Убрать пароль</button>
              </div>
            </>
          ) : (
            <div style={box}>
              <h3>Задать пароль</h3>
              <input type="password" placeholder="Новый пароль (≥ 8 символов)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              <button onClick={() => run(() => invoke("change_password", { oldPassword: "", newPassword: newPw }), "Пароль задан")}>Задать</button>
            </div>
          )}
          <div style={box}>
            <h3>Настроить восстановление</h3>
            {hasPw && <input type="password" placeholder="Текущий пароль" value={password} onChange={(e) => setPassword(e.target.value)} />}
            <RecoveryChooser allowNone={hasPw} {...{ kind, setKind, question, setQuestion, answer, setAnswer }} />
            <button
              onClick={() =>
                run(async () => {
                  const code = await invoke<string | null>("set_recovery", {
                    password: hasPw ? password : "", recoveryKind: kind, question, answer,
                  });
                  if (code) setCodeToShow(code);
                }, "Восстановление настроено")
              }
            >Применить</button>
          </div>
        </div>
      )}
    </div>
  );
}
