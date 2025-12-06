"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { ErrorBoundary } from "@/components/providers/ErrorBoundary";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Avoid hydration mismatch with Radix UI components that generate dynamic IDs
    if (!mounted) {
        return (
            <div className="flex h-screen bg-background">
                <div className="w-64 border-r bg-card" />
                <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="h-16 border-b bg-card" />
                    <main className="flex-1 overflow-y-auto bg-muted/10 p-6">
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
                <main className="flex-1 overflow-y-auto bg-muted/10 p-6">
                    <Breadcrumbs />
                    <ErrorBoundary>
                        {children}
                    </ErrorBoundary>
                </main>
            </div>
            <GlobalSearch />
        </div>
    );
}
