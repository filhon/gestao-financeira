"use client";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useState } from "react";
import { queryPersister } from "@/lib/queryPersister";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is considered fresh for 1 minute
            staleTime: 60 * 1000,
            // Telas visitadas há até 30 min reabrem do cache na hora (o padrão
            // de 5 min descartava o cache durante o uso normal)
            gcTime: 30 * 60 * 1000,
            // Retry failed queries 1 time
            retry: 1,
            // Don't refetch on window focus to save reads
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: 24 * 60 * 60 * 1000,
        // Cada deploy descarta o cache: o formato dos dados pode ter mudado.
        buster: process.env.NEXT_PUBLIC_BUILD_ID,
      }}
      // O restaurado aparece na hora e é relido em seguida: não mostra
      // número velho como se fosse atual por mais que uma ida ao servidor.
      onSuccess={() => queryClient.invalidateQueries()}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
