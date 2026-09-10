import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createNewItem, listNewItems } from "./api";
import type { NewItemFormValues } from "./types";

export function useNewItems() {
  return useQuery({
    queryKey: ["new-items"],
    queryFn: listNewItems,
    initialData: [],
  });
}

export function useCreateNewItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: NewItemFormValues) => createNewItem(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["new-items"] });
    },
  });
}
