# -*- coding: utf-8 -*-
"""
설정 로더 — 실명 사전·할증률·천장고·tolerance 를 YAML 에서 읽는다.

레이어명·실명·할증률·천장고·벽체 두께·tolerance 하드코딩은 금지다.
호출자는 항상 이 모듈을 거쳐 값을 얻고, 필요하면 인자로 덮어쓴다.
PyYAML 이 없는 환경에서도 엔진이 뜨도록 최소 파서를 내장한다.
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

_DIR = Path(__file__).parent


def _minimal_yaml(text: str) -> dict:
    """
    이 저장소의 설정 파일이 쓰는 범위만 지원하는 최소 YAML 파서.

    지원: 중첩 매핑(2칸 들여쓰기), `- 항목` 리스트, 숫자/불린/문자열, `#` 주석.
    PyYAML 이 설치돼 있으면 그쪽을 쓰므로 이 함수는 폴백 전용이다.
    """
    root: dict[str, Any] = {}
    # (들여쓰기, 컨테이너) 스택
    stack: list[tuple[int, Any]] = [(-1, root)]

    def cast(v: str) -> Any:
        s = v.strip()
        # 인라인 리스트 `[a, b, c]` — applies 항목이 이 형태다
        if s.startswith("[") and s.endswith("]"):
            inner = s[1:-1].strip()
            if not inner:
                return []
            return [cast(x) for x in inner.split(",")]
        s = s.strip('"').strip("'")
        if s in ("true", "yes"):
            return True
        if s in ("false", "no"):
            return False
        if re.fullmatch(r"-?\d+", s):
            return int(s)
        if re.fullmatch(r"-?\d*\.\d+", s):
            return float(s)
        return s

    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip() if not raw.lstrip().startswith("#") else ""
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip())
        body = line.strip()

        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]

        if body.startswith("- "):
            if not isinstance(parent, list):
                continue
            parent.append(cast(body[2:]))
            continue

        if ":" not in body:
            continue
        key, _, val = body.partition(":")
        key, val = key.strip(), val.strip()
        if val == "":
            # 다음 줄의 형태를 모르므로 일단 dict 로 열고, `- ` 가 오면 list 로 바꾼다
            child: Any = {}
            parent[key] = child
            stack.append((indent, child))
            # 리스트 여부는 뒤에서 판단 — placeholder 를 리스트로 승격하는 훅
            _PENDING.append((parent, key, indent))
        else:
            parent[key] = cast(val)
    return root


#: `key:` 뒤에 `- ` 가 오면 dict → list 로 승격하기 위한 임시 기록
_PENDING: list[tuple[dict, str, int]] = []


def _load_yaml(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore
        return yaml.safe_load(text) or {}
    except ImportError:
        pass

    # 폴백: `- ` 리스트를 먼저 감지해 해당 키를 리스트로 만들어 둔다
    lines = text.splitlines()
    list_keys: set[tuple[int, str]] = set()
    for i, raw in enumerate(lines):
        if not raw.strip().startswith("- "):
            continue
        ind = len(raw) - len(raw.lstrip())
        for j in range(i - 1, -1, -1):
            prev = lines[j].split("#", 1)[0].rstrip()
            if not prev.strip():
                continue
            pind = len(prev) - len(prev.lstrip())
            if pind < ind and prev.strip().endswith(":"):
                list_keys.add((pind, prev.strip()[:-1].strip()))
            break

    _PENDING.clear()
    data = _minimal_yaml(text)

    # dict 로 열렸지만 실제로는 리스트인 키를 다시 채운다
    def fix(node: Any, indent: int = 0) -> None:
        if not isinstance(node, dict):
            return
        for k, v in list(node.items()):
            if isinstance(v, dict) and not v and (indent, k) in list_keys:
                node[k] = _collect_list(text, k)
            else:
                fix(v, indent + 2)

    fix(data)
    return data


def _collect_list(text: str, key: str) -> list:
    """`key:` 바로 아래 `- ` 항목들을 모은다 (폴백 파서용)."""
    out: list[Any] = []
    lines = text.splitlines()
    for i, raw in enumerate(lines):
        stripped = raw.split("#", 1)[0].rstrip()
        if stripped.strip() != f"{key}:":
            continue
        base = len(stripped) - len(stripped.lstrip())
        for nxt in lines[i + 1:]:
            s = nxt.split("#", 1)[0].rstrip()
            if not s.strip():
                continue
            ind = len(s) - len(s.lstrip())
            if ind <= base:
                break
            if s.strip().startswith("- "):
                out.append(s.strip()[2:].strip().strip('"').strip("'"))
        break
    return out


@lru_cache(maxsize=4)
def rooms() -> dict:
    """실명 사전 + 시드 제외 패턴 + LDK 정책."""
    return _load_yaml(_DIR / "rooms.yaml")


@lru_cache(maxsize=4)
def takeoff() -> dict:
    """할증률·천장고·개구부 공제·tolerance 기본값."""
    return _load_yaml(_DIR / "takeoff.yaml")


def geometry(key: str, default: float | int | None = None) -> Any:
    """tolerance 류 단일 값 조회 — 호출부에서 인자로 덮어쓸 수 있게 얕게 노출."""
    return takeoff().get("geometry", {}).get(key, default)
