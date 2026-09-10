import type { NewItemFormValues, NewItemRecord } from "./types";

const mockItems: NewItemRecord[] = [
  {
    id: "seed-1",
    title: "첫 번째 아이템",
    description: "새 도구의 기본 화면과 폴더 구조를 준비한 샘플입니다.",
    status: "ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export async function listNewItems(): Promise<NewItemRecord[]> {
  return [...mockItems];
}

export async function createNewItem(payload: NewItemFormValues): Promise<NewItemRecord> {
  const nextItem: NewItemRecord = {
    id: crypto.randomUUID(),
    title: payload.title.trim() || "새 아이템",
    description: payload.description.trim() || "설명을 추가해 주세요.",
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  mockItems.unshift(nextItem);
  return nextItem;
}
