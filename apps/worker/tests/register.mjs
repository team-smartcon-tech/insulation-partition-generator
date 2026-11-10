// node --test 용 로더 등록: src 의 확장자 없는 상대 import("./auth")를 .ts 로 해석한다(wrangler/esbuild 는 알아서 하는 부분).
import { register } from "node:module";
register("./resolve-ts-hooks.mjs", import.meta.url);
