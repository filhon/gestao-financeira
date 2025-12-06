import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface CardSkeletonProps {
    showHeader?: boolean;
    showDescription?: boolean;
    contentLines?: number;
}

export function CardSkeleton({
    showHeader = true,
    showDescription = true,
    contentLines = 3
}: CardSkeletonProps) {
    return (
        <Card>
            {showHeader && (
                <CardHeader className="space-y-2">
                    <Skeleton className="h-6 w-1/3" />
                    {showDescription && <Skeleton className="h-4 w-2/3" />}
                </CardHeader>
            )}
            <CardContent className="space-y-3">
                {Array.from({ length: contentLines }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                ))}
            </CardContent>
        </Card>
    );
}

export function CardGridSkeleton({ count = 3 }: { count?: number }) {
    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: count }).map((_, i) => (
                <CardSkeleton key={i} />
            ))}
        </div>
    );
}
