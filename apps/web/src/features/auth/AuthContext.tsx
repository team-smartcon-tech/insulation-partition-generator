/**
 * 인증 컨텍스트 — react-query 로 세션(me) 확인 + 로그인/로그아웃.
 * 401 이벤트(elevFetch 등에서 dispatch)를 수신하면 세션을 무효화한다.
 */
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe, postLogin, postLogout, AuthError, type AuthUser } from "./authApi";

const ME_KEY = ["auth", "me"] as const;

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (body: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const meQuery = useQuery({
    queryKey: ME_KEY,
    queryFn: () => getMe().then((r) => r.user),
    retry: false,
    staleTime: 60_000,
    // 401 은 "로그인 안 됨"이라 정상 상태로 취급(에러 재시도 안 함)
    throwOnError: false,
  });

  // 세션 상태 도출:
  //  - 401(명확한 미인증)이면 로그아웃 상태로 확정(만료 후 refetch 401 시 stale user 유지 방지).
  //  - 그 외(네트워크 등 일시 오류)는 마지막 성공 데이터가 있으면 유지, 없으면 null.
  const is401 = meQuery.error instanceof AuthError && meQuery.error.status === 401;
  const user: AuthUser | null = is401 ? null : meQuery.data ?? null;

  useEffect(() => {
    const onExpired = () => {
      qc.setQueryData(ME_KEY, null);
      qc.invalidateQueries({ queryKey: ME_KEY });
    };
    window.addEventListener("ipg-auth-expired", onExpired);
    return () => window.removeEventListener("ipg-auth-expired", onExpired);
  }, [qc]);

  const loginMut = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      postLogin(body).then((r) => r.user),
    onSuccess: (u) => {
      qc.setQueryData(ME_KEY, u);
    },
  });

  const logoutMut = useMutation({
    mutationFn: () => postLogout(),
    onSuccess: () => {
      qc.setQueryData(ME_KEY, null);
      qc.invalidateQueries({ queryKey: ["elev-projects"] });
    },
  });

  const value: AuthContextValue = {
    user: user ?? null,
    isLoading: meQuery.isLoading,
    login: async (body) => {
      await loginMut.mutateAsync(body);
    },
    logout: async () => {
      await logoutMut.mutateAsync();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 는 AuthProvider 안에서만 사용");
  return ctx;
}
