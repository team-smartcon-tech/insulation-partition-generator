import { useState } from "react";
import { useCreateNewItem, useNewItems } from "./hooks";
import type { NewItemFormValues } from "./types";

const initialForm: NewItemFormValues = {
  title: "",
  description: "",
};

export default function NewItemPage() {
  const { data: items = [] } = useNewItems();
  const createMutation = useCreateNewItem();
  const [form, setForm] = useState<NewItemFormValues>(initialForm);

  const handleChange = (field: keyof NewItemFormValues, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.title.trim()) return;

    createMutation.mutate(form, {
      onSuccess: () => setForm(initialForm),
    });
  };

  return (
    <div className="min-h-screen bg-slate-100 px-6 py-10 text-slate-800">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">NEW ITEM</p>
          <h1 className="mt-2 text-3xl font-bold">새 아이템 시작 보드</h1>
          <p className="mt-2 text-sm text-slate-600">
            이 폴더는 새 기능을 빠르게 뼈대부터 만들기 위한 기본 구조입니다.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">아이템 목록</h2>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                {items.length}개
              </span>
            </div>

            <div className="space-y-3">
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                  아직 등록된 아이템이 없습니다.
                </div>
              ) : (
                items.map((item) => (
                  <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p>
                      </div>
                      <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                        {item.status}
                      </span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-xl font-semibold">새 아이템 생성</h2>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="title" className="mb-2 block text-sm font-medium text-slate-700">
                  이름
                </label>
                <input
                  id="title"
                  value={form.title}
                  onChange={(event) => handleChange("title", event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:bg-white"
                  placeholder="예: 신규 업무 자동화"
                />
              </div>

              <div>
                <label htmlFor="description" className="mb-2 block text-sm font-medium text-slate-700">
                  설명
                </label>
                <textarea
                  id="description"
                  value={form.description}
                  onChange={(event) => handleChange("description", event.target.value)}
                  rows={5}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:bg-white"
                  placeholder="이 아이템이 무엇을 하는지 간단히 적어 주세요."
                />
              </div>

              <button
                type="submit"
                disabled={createMutation.isPending || !form.title.trim()}
                className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {createMutation.isPending ? "생성 중..." : "아이템 생성"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
