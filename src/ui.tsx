import { useState } from "react";

export const RED = "#c00";
export const DRAFT_BG = "#fff1a8";
export const today = () => new Date().toLocaleDateString("sv-SE");
export const cell = { padding: "4px 8px", borderBottom: "1px solid #ddd", textAlign: "left" as const };
export const cellR = { padding: "4px 8px", borderBottom: "1px solid #ddd", textAlign: "right" as const, whiteSpace: "nowrap" as const };
export const bar = { display: "flex", gap: 8, flexWrap: "wrap" as const, marginBottom: 12, alignItems: "center" };

/** "123 000.50" -> "123 000" (до целых, банковское округление; копейки в базе остаются). */
export function whole(a: string): string {
  const s = a.replace(/[\s\u00a0]/g, "");
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return a;
  let n = BigInt(m[2]);
  const f = Number((m[3] ?? "").padEnd(2, "0").slice(0, 2));
  const up = f > 50 || (f === 50 && n % BigInt(2) === BigInt(1));
  if (up) n = n + BigInt(1);
  const digits = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return (m[1] === "-" && n !== BigInt(0) ? "-" : "") + digits;
}

/** Ввод целой суммы с пробелами по тысячам. Дробная часть (1–2 знака после . или ,) отбрасывается. */
export function formatInput(raw: string): string {
  let t = raw.replace(/[\s\u00a0]/g, "");
  const neg = t.startsWith("-");
  t = t.replace(/-/g, "").replace(/[.,]\d{0,2}$/, "").replace(/\D/g, "");
  t = t.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return (neg ? "-" : "") + t;
}

export function AmountInput(props: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      inputMode="numeric"
      placeholder={props.placeholder ?? "Сумма"}
      value={props.value}
      onChange={(e) => props.onChange(formatInput(e.target.value))}
      style={{ textAlign: "right" }}
    />
  );
}

/** Сумма без копеек: отрицательные красным; при скрытии суммы цвет не показывается. */
export function Amt({ a, hide, neg }: { a: string; hide: boolean; neg?: boolean }) {
  if (hide) return <span>••••</span>;
  const t = whole(a);
  const isNeg = neg ?? t.startsWith("-");
  return <span style={{ color: isNeg ? RED : undefined }}>{t}</span>;
}

export function DeleteButton({ onConfirm, text }: { onConfirm: () => void; text?: string }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <>
      <button onClick={() => { setArmed(false); onConfirm(); }}>Точно?</button>
      <button onClick={() => setArmed(false)}>Нет</button>
    </>
  ) : (
    <button onClick={() => setArmed(true)}>{text ?? "Удалить"}</button>
  );
}
