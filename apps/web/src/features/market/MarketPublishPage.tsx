/**
 * 게시하기 — 홈 카드로 노출할 외부 도구를 등록하는 폼. 관리자(super_admin·system_admin) 전용.
 * 등록하면 홈에 카드가 생기고, 카드를 누르면 상세(MarketAppDetailPage)로 간다.
 */
import { useCallback, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Check, ClipboardPaste, ImagePlus, LayoutGrid, Loader2, X } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { cn } from "@/lib/utils";
import MarketShell from "./MarketShell";
import { usePublishMarketApp } from "./hooks";
import { CATEGORIES, LOCATIONS, PLATFORM_TYPES, type MarketAppInput } from "./types";

const ADMIN_ROLES = new Set(["super_admin", "system_admin"]);
const MAX_SHOTS = 8;

/** 미리보기 URL을 함께 들고 다니는 첨부 이미지 */
interface Attachment {
  key: string;
  file: File;
  preview: string;
}

export default function MarketPublishPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const canPublish = ADMIN_ROLES.has(user?.role ?? "");

  const [form, setForm] = useState<MarketAppInput>({
    title: "",
    deployUrl: "",
    repoUrl: "",
    platformType: PLATFORM_TYPES[0],
    location: LOCATIONS[0],
    category: CATEGORIES[0],
    version: "",
    team: "",
    description: "",
    owners: [],
    tags: [],
  });
  const [shots, setShots] = useState<Attachment[]>([]);
  const [ownerDraft, setOwnerDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const publish = usePublishMarketApp();

  const set = <K extends keyof MarketAppInput>(key: K, value: MarketAppInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const addFiles = useCallback((files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setShots((prev) => {
      const room = MAX_SHOTS - prev.length;
      if (room <= 0) {
        toast.error(`스크린샷은 최대 ${MAX_SHOTS}장까지 올릴 수 있습니다.`);
        return prev;
      }
      const next = images.slice(0, room).map((file) => ({
        key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        preview: URL.createObjectURL(file),
      }));
      if (images.length > room) toast.error(`${MAX_SHOTS}장까지만 추가했습니다.`);
      return [...prev, ...next];
    });
  }, []);

  const removeShot = (key: string) =>
    setShots((prev) => {
      const target = prev.find((s) => s.key === key);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((s) => s.key !== key);
    });

  /** 클립보드 붙여넣기(캡처 → Ctrl+V) 지원 */
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  };

  const addChip = (kind: "owners" | "tags", raw: string) => {
    const value = raw.trim().replace(/,$/, "");
    if (!value) return;
    setForm((prev) =>
      prev[kind].includes(value) ? prev : { ...prev, [kind]: [...prev[kind], value] },
    );
  };

  const removeChip = (kind: "owners" | "tags", value: string) =>
    setForm((prev) => ({ ...prev, [kind]: prev[kind].filter((v) => v !== value) }));

  const invalidReason = useMemo(() => {
    if (!form.title.trim()) return "제목을 입력하세요.";
    if (!form.deployUrl.trim()) return "배포 URL을 입력하세요.";
    if (!/^https?:\/\/.+/i.test(form.deployUrl.trim())) {
      return "배포 URL은 http:// 또는 https:// 로 시작해야 합니다.";
    }
    if (form.repoUrl.trim() && !/^https?:\/\/.+/i.test(form.repoUrl.trim())) {
      return "레포 URL은 http:// 또는 https:// 로 시작해야 합니다.";
    }
    if (shots.length === 0) return "실제 실행 화면 스크린샷을 1장 이상 올려 주세요.";
    return null;
  }, [form, shots]);

  const submit = async () => {
    if (invalidReason) {
      toast.error(invalidReason);
      return;
    }
    try {
      const { app } = await publish.mutateAsync({
        input: {
          ...form,
          title: form.title.trim(),
          deployUrl: form.deployUrl.trim(),
          repoUrl: form.repoUrl.trim(),
          version: form.version.trim(),
          team: form.team.trim(),
          description: form.description.trim(),
        },
        shots: shots.map((s) => s.file),
      });
      shots.forEach((s) => URL.revokeObjectURL(s.preview));
      toast.success("게시했습니다.");
      navigate(app?.id ? `/market/${app.id}` : "/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "게시에 실패했습니다.");
    }
  };

  if (!canPublish) {
    return (
      <MarketShell>
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <div className="text-[15px] font-bold text-slate-800">게시 권한이 없습니다.</div>
          <p className="mt-2 text-[13px] text-slate-500">
            도구 게시는 최고 관리자·시스템 관리자만 할 수 있습니다.
          </p>
        </div>
      </MarketShell>
    );
  }

  return (
    <MarketShell>
      <h1 className="text-[26px] font-bold tracking-tight text-slate-900">게시하기</h1>
      <p className="mt-1.5 text-[13.5px] text-slate-500">
        사내에서 만든 앱·도구를 홈에 등록합니다. 등록하면 바로 카드로 노출됩니다.
      </p>

      <div className="mt-6 flex items-center gap-2.5 rounded-xl border-2 border-[#0a63b8] bg-[#f4f8fd] px-4 py-3">
        <LayoutGrid className="h-[18px] w-[18px] text-[#0a63b8]" />
        <span className="text-[13.5px] font-semibold text-slate-800">
          앱·플랫폼 · 사내에서 만든 웹앱·플랫폼을 공유하고 바로 실행
        </span>
      </div>

      <div className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <Field label="제목" required>
          <input
            className={inputCls}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="예) 줄눈컷팅 자동화"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="배포 URL" required hint="카드·상세의 '바로가기'가 이 주소로 연결됩니다.">
            <input
              className={inputCls}
              value={form.deployUrl}
              onChange={(e) => set("deployUrl", e.target.value)}
              placeholder="https://"
            />
          </Field>
          <Field label="레포 URL">
            <input
              className={inputCls}
              value={form.repoUrl}
              onChange={(e) => set("repoUrl", e.target.value)}
              placeholder="https://github.com/owner/repo"
            />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="플랫폼 타입">
            <select
              className={inputCls}
              value={form.platformType}
              onChange={(e) => set("platformType", e.target.value)}
            >
              {PLATFORM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="위치">
            <div className="flex gap-2">
              {LOCATIONS.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => set("location", loc)}
                  className={cn(
                    "h-11 flex-1 rounded-lg border text-[14px] font-semibold transition-colors",
                    form.location === loc
                      ? "border-[#0a63b8] bg-[#0a63b8] text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {loc}
                </button>
              ))}
            </div>
          </Field>
        </div>

        {/* 스크린샷 */}
        <Field
          label="스크린샷"
          required
          hint={`실제 실행 화면을 1장 이상 올려 주세요. 첫 번째 이미지가 목록 썸네일로 쓰입니다. (최대 ${MAX_SHOTS}장)`}
        >
          <div
            onPaste={onPaste}
            tabIndex={0}
            className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 outline-none transition-colors focus:border-[#0a63b8]"
          >
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-[86px] w-[110px] flex-col items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-[12px] font-medium text-slate-500 transition-colors hover:border-[#0a63b8]/40 hover:text-[#0a63b8]"
              >
                <ImagePlus className="h-5 w-5" />
                이미지 추가
              </button>
              <div className="flex h-[86px] w-[110px] flex-col items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-[12px] font-medium text-slate-400">
                <ClipboardPaste className="h-5 w-5" />
                붙여넣기
              </div>
              {shots.map((shot, idx) => (
                <div
                  key={shot.key}
                  className="group relative h-[86px] w-[110px] overflow-hidden rounded-lg border border-slate-200 bg-white"
                >
                  <img
                    src={shot.preview}
                    alt={shot.file.name}
                    className="h-full w-full object-cover"
                  />
                  {idx === 0 && (
                    <span className="absolute left-1 top-1 rounded bg-[#0a63b8] px-1.5 py-0.5 text-[10px] font-bold text-white">
                      썸네일
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeShot(shot.key)}
                    className="absolute right-1 top-1 rounded-full bg-slate-900/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    title="제거"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="카테고리" required>
            <select
              className={inputCls}
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </Field>
          <Field label="버전" hint="비워 두면 v1.0 으로 시작합니다.">
            <input
              className={inputCls}
              value={form.version}
              onChange={(e) => set("version", e.target.value)}
              placeholder="예) v1.0"
            />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="팀">
            <input
              className={inputCls}
              value={form.team}
              onChange={(e) => set("team", e.target.value)}
              placeholder="예) 기술연구소"
            />
          </Field>
          <Field label="담당자" hint="Enter 로 여러 명 추가">
            <ChipInput
              draft={ownerDraft}
              setDraft={setOwnerDraft}
              values={form.owners}
              onAdd={(v) => addChip("owners", v)}
              onRemove={(v) => removeChip("owners", v)}
              placeholder="예) 홍길동, 김철수"
            />
          </Field>
        </div>

        <Field label="설명">
          <textarea
            className={cn(inputCls, "h-28 resize-y py-2.5 leading-relaxed")}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="카드에 표시될 한두 줄 요약"
          />
        </Field>

        <Field label="태그" hint="쉼표 또는 Enter 로 태그 추가">
          <ChipInput
            draft={tagDraft}
            setDraft={setTagDraft}
            values={form.tags}
            onAdd={(v) => addChip("tags", v)}
            onRemove={(v) => removeChip("tags", v)}
            placeholder="예) 타일, 컷팅"
          />
        </Field>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="h-11 rounded-lg border border-slate-200 bg-white px-5 text-[14px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
        >
          이전
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={publish.isPending}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#0a63b8] px-6 text-[14px] font-bold text-white shadow-[0_10px_24px_-12px_rgba(10,99,184,0.9)] transition-colors hover:bg-[#004791] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {publish.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          게시하기
        </button>
      </div>
    </MarketShell>
  );
}

const inputCls =
  "h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 text-[14px] text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-[#0a63b8] focus:ring-2 focus:ring-[#0a63b8]/15";

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-[12px] text-slate-400">{hint}</p>}
    </div>
  );
}

/** Enter·쉼표로 항목을 쌓는 입력 (담당자·태그 공용) */
function ChipInput({
  draft,
  setDraft,
  values,
  onAdd,
  onRemove,
  placeholder,
}: {
  draft: string;
  setDraft: (v: string) => void;
  values: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder?: string;
}) {
  const commit = () => {
    if (!draft.trim()) return;
    draft
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .forEach(onAdd);
    setDraft("");
  };

  return (
    <div>
      <input
        className={inputCls}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          // 쉼표를 치는 순간 바로 칩으로 확정
          if (v.endsWith(",")) {
            setDraft(v);
            requestAnimationFrame(() => {
              v.split(",").map((s) => s.trim()).filter(Boolean).forEach(onAdd);
              setDraft("");
            });
            return;
          }
          setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
      {values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[12px] font-medium text-slate-600"
            >
              {v}
              <button
                type="button"
                onClick={() => onRemove(v)}
                className="text-slate-400 transition-colors hover:text-slate-700"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
