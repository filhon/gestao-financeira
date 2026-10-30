"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { flatNav, isGroup, visibleNav } from "@/components/layout/navItems";

// Configurações vive na sidebar; esta rota só encaminha para o primeiro item.
export default function SettingsPage() {
  const router = useRouter();
  const permissions = usePermissions();

  useEffect(() => {
    const group = visibleNav(permissions).find(
      (e) => isGroup(e) && e.title === "Configurações",
    );
    router.replace(group ? flatNav([group])[0].href : "/dashboard");
  }, [permissions, router]);

  return null;
}
