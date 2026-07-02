# Git Hooks

이 디렉토리의 훅은 **도구 무관**하게 Git 레벨에서 동작한다.

## 활성화

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push
```

## 포함된 훅

- `pre-commit` — `.env`/시크릿 문자열 커밋 차단.
- `pre-push` — `main` 브랜치 직접 푸시 차단.
