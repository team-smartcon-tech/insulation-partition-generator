/**
 * useFullscreen — CAD 처럼 브라우저 크롬(탭·주소창) 없이 전체화면으로 쓰기 위한 훅.
 *
 * 브라우저는 사용자 제스처 없이 requestFullscreen 을 허용하지 않는다.
 * 그래서 "자동 전체화면"이 켜져 있으면 화면 진입 후 **첫 클릭/키 입력 한 번**에
 * 전체화면으로 들어간다(1회만). 설정은 localStorage 에 보관한다.
 */
import { useCallback, useEffect, useState } from "react";

const AUTO_KEY = "ipg.autoFullscreen";

function isFsNow() {
  return typeof document !== "undefined" && !!document.fullscreenElement;
}

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(isFsNow);
  const [autoEnter, setAutoEnter] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(AUTO_KEY) !== "off"; // 기본 ON
  });

  // 브라우저 상태 동기화 (Esc·F11 로 빠져나가는 경우 포함)
  useEffect(() => {
    const onChange = () => setIsFullscreen(isFsNow());
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const enter = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch {
      /* 사용자가 거부했거나 제스처 없이 호출됨 — 무시 */
    }
  }, []);

  const exit = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    if (isFsNow()) void exit();
    else void enter();
  }, [enter, exit]);

  const setAuto = useCallback((v: boolean) => {
    setAutoEnter(v);
    try {
      localStorage.setItem(AUTO_KEY, v ? "on" : "off");
    } catch {
      /* ignore */
    }
  }, []);

  // 자동 전체화면 — 첫 사용자 제스처 1회
  useEffect(() => {
    if (!autoEnter || isFsNow()) return;
    let done = false;
    const kick = () => {
      if (done) return;
      done = true;
      void enter();
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    return cleanup;
  }, [autoEnter, enter]);

  return { isFullscreen, toggle, enter, exit, autoEnter, setAuto };
}
