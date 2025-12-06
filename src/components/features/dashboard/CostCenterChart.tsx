"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CostCenterData } from "@/lib/services/dashboardService";
import {
    Cell,
    Legend,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
} from "recharts";

interface CostCenterChartProps {
    data: CostCenterData[];
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

export function CostCenterChart({ data }: CostCenterChartProps) {
    return (
        <Card className="col-span-3">
            <CardHeader>
                <CardTitle>Despesas por Centro de Custo (Mês Atual)</CardTitle>
            </CardHeader>
            <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                    <PieChart>
                        <Pie
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            data={data as any}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            outerRadius={80}
                            fill="#8884d8"
                            dataKey="value"
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(value: number) => [`R$ ${value.toFixed(2)}`, "Valor"]}
                            contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--popover-foreground))' }}
                        />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </CardContent>
        </Card >
    );
}
