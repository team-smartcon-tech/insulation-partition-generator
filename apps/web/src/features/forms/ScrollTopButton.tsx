/**
 * 맨 위로 단추 — 오른쪽 아래에 떠 있다.
 *
 * 왜 필요한가: [작성하기]를 누르면 서류가 목록 **아래**에 펼쳐지고 화면이 그리로 내려간다.
 * 다른 서류를 고르러 목록으로 돌아가려면 한참 굴려 올라가야 했다(사용자 요청, 2026-10-06).
 *
 * 조금 내려갔을 때만 보인다 — 맨 위에서는 누를 일이 없다. 인쇄에는 나오지 않는다.
 */
import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/** 이만큼(px) 내려가면 단추를 띄운다 */
const SHOW_AFTER = 400;

export default function ScrollTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > SHOW_AFTER);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      title="맨 위로"
      aria-label="맨 위로"
      className="fixed bottom-6 right-6 z-30 flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-lg ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-[#1d6fd8] print:hidden"
    >
      <ArrowUp size={16} aria-hidden />
      맨 위로
    </button>
  );
}
