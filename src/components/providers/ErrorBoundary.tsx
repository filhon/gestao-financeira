"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="flex min-h-[400px] items-center justify-center p-4">
                    <Card className="w-full max-w-md">
                        <CardHeader className="text-center">
                            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                                <AlertTriangle className="h-6 w-6 text-destructive" />
                            </div>
                            <CardTitle>Algo deu errado</CardTitle>
                            <CardDescription>
                                Ocorreu um erro inesperado. Por favor, tente novamente.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col items-center gap-4">
                            {process.env.NODE_ENV === "development" && this.state.error && (
                                <pre className="max-h-32 w-full overflow-auto rounded bg-muted p-2 text-xs">
                                    {this.state.error.message}
                                </pre>
                            )}
                            <div className="flex flex-wrap gap-2 justify-center">
                                <Button onClick={this.handleRetry} variant="outline">
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Tentar Novamente
                                </Button>
                                <Button onClick={() => window.location.href = "/"}>
                                    Ir para Início
                                </Button>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground"
                                onClick={() => {
                                    const errorMessage = encodeURIComponent(this.state.error?.message || "Erro desconhecido");
                                    const errorUrl = encodeURIComponent(window.location.href);
                                    window.location.href = `/feedback?error=${errorMessage}&url=${errorUrl}`;
                                }}
                            >
                                <MessageSquare className="mr-2 h-4 w-4" />
                                Reportar Problema
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            );
        }

        return this.props.children;
    }
}
