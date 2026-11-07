import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  FEEDBACK_STATUS_CLASS,
  feedbackStatusLabel,
  timelineOf,
} from "@/lib/feedback";
import type { Feedback, FeedbackStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const stamp = (d: Date) => format(d, "dd/MM/yyyy 'às' HH:mm");

export function FeedbackStatusBadge({
  status,
  viewer,
}: {
  status: FeedbackStatus;
  viewer: "user" | "team";
}) {
  return (
    <Badge className={cn("text-xs", FEEDBACK_STATUS_CLASS[status])}>
      {feedbackStatusLabel(status, viewer)}
    </Badge>
  );
}

/** O relato seguido de mensagens e mudanças de situação, na ordem em que aconteceram. */
export function FeedbackTimeline({
  feedback,
  viewer,
}: {
  feedback: Feedback;
  viewer: "user" | "team";
}) {
  const author = (from: "user" | "team", name: string) =>
    from === "team" ? name : viewer === "user" ? "Você" : name;

  return (
    <ol className="space-y-3">
      <li className="rounded-md border p-3">
        <p className="mb-1 text-xs text-muted-foreground">
          {author("user", feedback.userName)} · {stamp(feedback.createdAt)}
        </p>
        <p className="whitespace-pre-wrap break-words text-sm">
          {feedback.description}
        </p>
      </li>
      {timelineOf(feedback).map((event) =>
        event.kind === "status" ? (
          <li key={event.id} className="px-3 text-xs text-muted-foreground">
            {event.status && feedbackStatusLabel(event.status, viewer)}
            {event.text ? `: ${event.text}` : ""} · {stamp(event.at)}
          </li>
        ) : (
          <li
            key={event.id}
            className={cn(
              "rounded-md border p-3",
              event.from === "team" && "bg-muted/50",
            )}
          >
            <p className="mb-1 text-xs text-muted-foreground">
              {author(event.from, event.authorName)} · {stamp(event.at)}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm">
              {event.text}
            </p>
          </li>
        ),
      )}
    </ol>
  );
}
