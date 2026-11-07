import { Suspense } from "react";
import { MyFeedbacks } from "@/components/features/feedback/MyFeedbacks";

export default function FeedbackPage() {
  return (
    <Suspense>
      <MyFeedbacks />
    </Suspense>
  );
}
