"use client";

import { useSyncExternalStore } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { MobileNav } from "@/components/layout/MobileNav";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { ErrorBoundary } from "@/components/providers/ErrorBoundary";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

// Use useSyncExternalStore to detect client-side hydration
// This avoids the "setState in useEffect" warning
const emptySubscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { canViewDashboard } = usePermissions();

  // Track if the user was ever loaded, to distinguish between
  // "never authenticated" vs "transient null after token refresh"
  const wasAuthenticatedRef = useRef(false);
  useEffect(() => {
    if (user) {
      wasAuthenticatedRef.current = true;
    }
  }, [user]);

  // Security: Block pending/rejected users from accessing dashboard
  // Backward compatibility: if status is missing but active is true, treat as 'active'
  const effectiveStatus = user?.status || (user?.active ? "active" : "pending");

  useEffect(() => {
    if (!loading) {
      if (!user && !wasAuthenticatedRef.current) {
        // Only redirect to login if the user was never authenticated in
        // this session. This prevents a redirect when user is temporarily
        // null during a background token refresh.
        router.push("/login");
      } else if (user) {
        if (effectiveStatus !== "active") {
          router.push("/pending-approval");
        } else if (pathname === "/dashboard" && !canViewDashboard) {
          // If user lands on dashboard root but can't view dashboard (e.g. role 'user'),
          // redirect to their allowed area (e.g. Payables)
          router.push("/financeiro/contas-pagar");
        }
      }
    }
  }, [loading, user, effectiveStatus, canViewDashboard, pathname, router]);

  // Show loading spinner while AuthProvider is initializing
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!loading && user && effectiveStatus !== "active") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Avoid hydration mismatch with Radix UI components that generate dynamic IDs
  if (!mounted) {
    return (
      <div className="flex h-screen bg-background">
        <div className="hidden md:block w-64 border-r bg-card" />
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="h-14 border-b bg-card" />
          <main className="flex-1 overflow-y-auto bg-muted/10 p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex flex-1 flex-col overflow-hidden bg-muted/10">
          <div className="hidden md:block flex-none px-6 pt-6">
            <Breadcrumbs />
          </div>
          <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:pb-6 min-h-0">
            <ErrorBoundary>{children}</ErrorBoundary>
          </div>
        </main>
      </div>
      <MobileNav />
      <GlobalSearch />
    </div>
  );
}
