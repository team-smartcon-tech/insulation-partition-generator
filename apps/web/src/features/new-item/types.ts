export type NewItemStatus = "draft" | "ready";

export interface NewItemRecord {
  id: string;
  title: string;
  description: string;
  status: NewItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NewItemFormValues {
  title: string;
  description: string;
}
