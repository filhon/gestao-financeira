"use client";

import { Button } from "@/components/ui/button";
import { Database, Loader2 } from "lucide-react";
import { seedRoadmapData } from "@/lib/seedRoadmap";
import { useAuth } from "@/components/providers/AuthProvider";
import { useState } from "react";

export function SeedButton() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  if (user?.role !== 'admin') return null;

  const handleSeed = async () => {
    setLoading(true);
    await seedRoadmapData(user.uid);
    setLoading(false);
    // Force reload to see changes
    window.location.reload(); 
  };

  return (
    <Button variant="outline" size="sm" onClick={handleSeed} disabled={loading}>
      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
      {loading ? "Populando..." : "Popular Dados Iniciais"}
    </Button>
  );
}
