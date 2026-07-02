import { Route, Switch } from "wouter";

// 뼈대 단계: 자리표시 화면만 렌더링합니다.
// 실제 "단열재 나누기도" 기능(DXF 업로드·외벽 그리기·나누기도·수량 산출)은
// 다음 단계에서 원본(SSX)에서 이식합니다.
export default function App() {
  return (
    <Switch>
      <Route path="/">
        <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", lineHeight: 1.6 }}>
          <h1>단열재 나누기도 생성기</h1>
          <p>뼈대 생성 완료. 기능 이식은 다음 단계입니다.</p>
        </main>
      </Route>
      <Route>
        <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
          <p>페이지를 찾을 수 없습니다.</p>
        </main>
      </Route>
    </Switch>
  );
}
