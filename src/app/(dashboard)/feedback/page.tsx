"use client";

import { useEffect, useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FeedbackForm } from "@/components/features/feedback/FeedbackForm";
import { FeedbackList } from "@/components/features/feedback/FeedbackList";
import { feedbackService } from "@/lib/services/feedbackService";
import { Feedback } from "@/lib/types";
import { useAuth } from "@/components/providers/AuthProvider";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function FeedbackPageContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("new");

  // Check for error context from ErrorBoundary
  const errorMessage = searchParams.get("error");
  const errorUrl = searchParams.get("url");
  const errorContext = useMemo(
    () =>
      errorMessage && errorUrl
        ? {
            message: decodeURIComponent(errorMessage),
            url: decodeURIComponent(errorUrl),
            timestamp: new Date(),
          }
        : undefined,
    [errorMessage, errorUrl]
  );

  // If coming from an error, switch to "new" tab
  useEffect(() => {
    if (errorContext) {
      setActiveTab("new");
    }
  }, [errorContext]);

  const loadFeedbacks = async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      const data = await feedbackService.getByUser(user.uid);
      setFeedbacks(data);
    } catch (error) {
      console.error("Error loading feedbacks:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFeedbacks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleFeedbackSuccess = () => {
    setActiveTab("history");
    loadFeedbacks();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Feedback</h1>
        <p className="text-muted-foreground">
          Ajude-nos a melhorar o sistema compartilhando sua opinião.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="new">Novo Feedback</TabsTrigger>
          <TabsTrigger value="history">
            Meus Feedbacks ({feedbacks.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="mt-6">
          <FeedbackForm
            onSuccess={handleFeedbackSuccess}
            errorContext={errorContext}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <FeedbackList feedbacks={feedbacks} isLoading={isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function FeedbackPage() {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <FeedbackPageContent />
    </Suspense>
  );
}
