import React from "react"
import { Card, CardContent } from "../ui/card"
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react"
import { Line, LineChart, ResponsiveContainer } from "recharts"

interface KPIFormat {
  value: number
  previousValue: number
  growth: number
  sparkline?: number[]
}

interface ExecutiveKpiCardProps {
  title: string
  kpi: KPIFormat
  icon: React.ElementType
  formatAsCurrency?: boolean
  inverseColors?: boolean // true if lower is better (e.g. expenses, defaults)
}

export function ExecutiveKpiCard({
  title,
  kpi,
  icon: Icon,
  formatAsCurrency = true,
  inverseColors = false
}: ExecutiveKpiCardProps) {
  const formatValue = (val: number) => {
    if (formatAsCurrency) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val / 100)
    }
    return new Intl.NumberFormat('pt-BR').format(val)
  }

  const isPositiveGrowth = kpi.growth > 0
  const isNeutral = kpi.growth === 0

  let GrowthIcon = Minus
  let growthColor = "text-slate-500"
  
  if (isPositiveGrowth) {
    GrowthIcon = ArrowUpRight
    growthColor = inverseColors ? "text-red-500" : "text-emerald-500"
  } else if (!isNeutral) {
    GrowthIcon = ArrowDownRight
    growthColor = inverseColors ? "text-emerald-500" : "text-red-500"
  }

  const sparklineData = kpi.sparkline?.map((val, index) => ({ value: val, index })) || []

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <div className="p-2 bg-slate-50 rounded-md">
            <Icon className="h-4 w-4 text-slate-500" />
          </div>
        </div>
        <div className="mt-4 flex items-end justify-between">
          <div>
            <h3 className="text-2xl font-bold tracking-tight text-slate-900">
              {formatValue(kpi.value)}
            </h3>
            <p className="mt-1 flex items-center text-sm font-medium">
              <span className={`flex items-center ${growthColor}`}>
                <GrowthIcon className="mr-1 h-3.5 w-3.5" />
                {Math.abs(kpi.growth).toFixed(1)}%
              </span>
              <span className="ml-2 text-slate-500 font-normal">
                vs anterior
              </span>
            </p>
          </div>
          {sparklineData.length > 0 && (
            <div className="h-12 w-24">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sparklineData}>
                  <Line 
                    type="monotone" 
                    dataKey="value" 
                    stroke={isPositiveGrowth ? (inverseColors ? "#ef4444" : "#10b981") : (inverseColors ? "#10b981" : "#ef4444")} 
                    strokeWidth={2} 
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
