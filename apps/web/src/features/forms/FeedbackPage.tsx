/**
 * 오류·개선 의견 — **모든 직원**이 쓰고 모두가 본다.
 *
 * 왜 모두에게 보이나: 같은 불편을 다섯 사람이 따로 적으면 본사는 같은 이야기를 다섯 번 읽는다.
 * 남이 올린 것이 보이면 "나도 그렇다"로 끝나고, 어디까지 고쳐졌는지도 함께 보인다.
 *
 * 누가 무엇을 하나
 * - 누구나: 올린다 · 내가 올린 것은 고치고 지운다.
 * - 본사 관리자: 상태를 바꾸고 답을 단다(판단은 서버가 한다 — 화면은 단추를 감출 뿐이다).
 */
import { useCallback, useEffect, useState } from "react";
import { Bug, Check, Lightbulb, MessageSquare, RefreshCw, Send, Trash2 } from "lucide-react";
import {
  deleteFeedback,
  fetchFeedback,
  patchFeedback,
  postFeedback,
  ServerUnavailable,
  type FeedbackRow,
} from "./formServer";

const STATUS = {
  open: { label: "접수", tone: "bg-slate-100 text-slate-700" },
  doing: { label: "확인 중", tone: "bg-amber-100 text-amber-800" },
  done: { label: "처리 완료", tone: "bg-emerald-100 text-emerald-800" },
  wont: { label: "하지 않음", tone: "bg-slate-200 text-slate-500" },
} as const;

const KIND = {
  bug: { label: "오류", icon: Bug, tone: "bg-rose-100 text-rose-700" },
  idea: { label: "개선 의견", icon: Lightbulb, tone: "bg-blue-100 text-blue-700" },
} as const;

/** `2026-09-30T08:31:00Z` → `09-30 08:31` */
function whenText(iso: string | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
}

interface FeedbackPageProps {
  /** 본사 관리자인가 — 상태·답 단추를 보일지 정한다(서버도 따로 막는다). */
  admin: boolean;
  /** 지금 로그인한 사람의 이메일 — 내 글만 고치고 지울 수 있다. */
  myEmail?: string;
}

export default function FeedbackPage({ admin, myEmail }: FeedbackPageProps) {
  const [items, setItems] = useState<FeedbackRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "bug" | "idea" | "open">("all");

  // 새 글
  const [kind, setKind] = useState<"bug" | "idea">("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [whereAt, setWhereAt] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await fetchFeedback());
      setState("ready");
      setError(null);
    } catch (err) {
      if (err instanceof ServerUnavailable) setState("offline");
      else setError(err instanceof Error ? err.message : "의견을 읽지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (title.trim() === "" || sending) return;
    setSending(true);
    try {
      await postFeedback({ kind, title: title.trim(), body: body.trim(), whereAt: whereAt.trim() });
      setTitle("");
      setBody("");
      setWhereAt("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "의견을 올리지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  /** 상태·답을 바꾼다(본사). 실패하면 알리고 목록을 다시 읽어 서버와 맞춘다. */
  async function change(id: string, patch: Parameters<typeof patchFeedback>[1]) {
    try {
      await patchFeedback(id, patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : "바꾸지 못했습니다.");
    }
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm("이 의견을 지울까요?")) return;
    try {
      await deleteFeedback(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "지우지 못했습니다.");
    }
    await load();
  }

  const shown = items.filter((item) =>
    filter === "all" ? true : filter === "open" ? item.status === "open" || item.status === "doing" : item.kind === filter,
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <MessageSquare size={18} className="text-blue-600" /> 오류·개선 의견
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            쓰다가 이상한 것, 이랬으면 좋겠는 것을 적어 주세요. 모든 직원이 함께 봅니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-300 transition hover:bg-slate-50"
        >
          <RefreshCw size={14} /> 새로 읽기
        </button>
      </header>

      {/* 새 의견 적기 — 목록 위에 늘 펼쳐 둔다. 단추를 눌러야 열리면 적지 않고 지나간다. */}
      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex gap-2">
          {(["bug", "idea"] as const).map((value) => {
            const { label, icon: Icon } = KIND[value];
            const on = kind === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ring-1 " +
                  (on ? "bg-blue-600 text-white ring-blue-600" : "text-slate-600 ring-slate-300 hover:bg-slate-50")
                }
              >
                <Icon size={14} /> {label}
              </button>
            );
          })}
        </div>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={kind === "bug" ? "무엇이 잘못됐나요? (예: 결재 후 내려받으면 도장이 안 찍힙니다)" : "무엇이 있으면 좋을까요?"}
          className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          placeholder="자세한 내용(어떻게 하면 다시 생기는지 적어 주시면 빨리 고칩니다)"
          className="mb-2 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={whereAt}
            onChange={(event) => setWhereAt(event.target.value)}
            placeholder="어느 화면·서류에서 (예: 현장 서류함 › 101 이해관계자)"
            className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            disabled={title.trim() === "" || sending}
            onClick={() => void submit()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Send size={14} /> {sending ? "올리는 중…" : "올리기"}
          </button>
        </div>
      </section>

      {error && (
        <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
      )}
      {state === "offline" && (
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          서버에 연결하지 못했습니다. 인터넷이 돌아오면 [새로 읽기]를 눌러 주세요.
        </p>
      )}

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {([
          ["all", `전체 ${items.length}`],
          ["open", `아직 처리 전 ${items.filter((i) => i.status === "open" || i.status === "doing").length}`],
          ["bug", `오류 ${items.filter((i) => i.kind === "bug").length}`],
          ["idea", `개선 ${items.filter((i) => i.kind === "idea").length}`],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={
              "rounded-full px-3 py-1 font-medium transition ring-1 " +
              (filter === value ? "bg-slate-800 text-white ring-slate-800" : "text-slate-600 ring-slate-300 hover:bg-slate-50")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {state === "loading" ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          읽는 중…
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          아직 올라온 의견이 없습니다. 첫 의견을 적어 주세요.
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((item) => (
            <FeedbackCard
              key={item.id}
              item={item}
              admin={admin}
              mine={(item.author_email ?? "").toLowerCase() === (myEmail ?? "").toLowerCase() && !!myEmail}
              onChange={change}
              onRemove={remove}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedbackCard({
  item,
  admin,
  mine,
  onChange,
  onRemove,
}: {
  item: FeedbackRow;
  admin: boolean;
  mine: boolean;
  onChange: (id: string, patch: Parameters<typeof patchFeedback>[1]) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState(item.reply ?? "");
  const kind = KIND[item.kind] ?? KIND.bug;
  const status = STATUS[item.status] ?? STATUS.open;
  const KindIcon = kind.icon;

  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${kind.tone}`}>
          <KindIcon size={12} /> {kind.label}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.tone}`}>{status.label}</span>
        <span className="text-sm font-semibold text-slate-800">{item.title}</span>
        <span className="ml-auto text-[11px] text-slate-400">
          {item.author_name || "이름 없음"} · {whenText(item.created_at)}
        </span>
      </div>

      {item.body && <p className="whitespace-pre-wrap text-sm text-slate-600">{item.body}</p>}
      {item.where_at && <p className="mt-1 text-xs text-slate-400">자리: {item.where_at}</p>}

      {item.reply && (
        <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
          <span className="mb-0.5 block text-[11px] font-semibold text-blue-700">
            본사 답 · {item.replied_by} · {whenText(item.replied_at ?? undefined)}
          </span>
          <span className="whitespace-pre-wrap">{item.reply}</span>
        </div>
      )}

      {(admin || mine) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-slate-200 pt-2.5 text-xs">
          {admin &&
            (["open", "doing", "done", "wont"] as const).map((value) => (
              <button
                key={value}
                type="button"
                disabled={item.status === value}
                onClick={() => void onChange(item.id, { status: value })}
                className={
                  "rounded-lg px-2.5 py-1 font-medium transition ring-1 " +
                  (item.status === value
                    ? "bg-slate-800 text-white ring-slate-800"
                    : "text-slate-600 ring-slate-300 hover:bg-slate-50")
                }
              >
                {STATUS[value].label}
              </button>
            ))}
          {admin && (
            <button
              type="button"
              onClick={() => setReplying((on) => !on)}
              className="rounded-lg px-2.5 py-1 font-medium text-blue-700 ring-1 ring-blue-300 transition hover:bg-blue-50"
            >
              {item.reply ? "답 고치기" : "답 달기"}
            </button>
          )}
          {/* 지우기는 **내 글**, 그리고 본사 관리자. 서버가 허용하는 것과 화면을 맞춘다. */}
          {(mine || admin) && (
            <button
              type="button"
              onClick={() => void onRemove(item.id)}
              className="ml-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-50"
            >
              <Trash2 size={12} /> 지우기
            </button>
          )}
        </div>
      )}

      {replying && (
        <div className="mt-2 flex items-start gap-2">
          <textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={2}
            placeholder="현장에 알릴 답(예: 다음 주에 고쳐 올립니다)"
            className="flex-1 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={async () => {
              await onChange(item.id, { reply });
              setReplying(false);
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
          >
            <Check size={13} /> 남기기
          </button>
        </div>
      )}
    </li>
  );
}
