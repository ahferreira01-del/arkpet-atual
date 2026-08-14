import React from "react"
import { Card, CardContent } from "../ui/card"
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react"
import { Line, LineChart, ResponsiveContainer } from "recharts"
import { formatCentsToBRL } from "@/lib/money";

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
  inverseColors?: boolean
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
      return formatCentsToBRL(val)
    }
    return new Intl.NumberFormat('pt-BR').format(val)
  }

  const isPositiveGrowth = kpi.growth > 0
  const isNeutral = kpi.growth === 0

  let GrowthIcon = Minus
  let growthColor = "text-muted-foreground"
  let strokeColor = "hsl(var(--muted-foreground))"
  
  if (isPositiveGrowth) {
    GrowthIcon = ArrowUpRight
    growthColor = inverseColors ? "text-destructive" : "text-success"
    strokeColor = inverseColors ? "hsl(var(--destructive))" : "hsl(var(--success))"
  } else if (!isNeutral) {
    GrowthIcon = ArrowDownRight
    growthColor = inverseColors ? "text-success" : "text-destructive"
    strokeColor = inverseColors ? "hsl(var(--success))" : "hsl(var(--destructive))"
  }

  const sparklineData = kpi.sparkline?.map((val, index) => ({ value: val, index })) || []

  return (
    <Card className="hover:shadow-md transition-shadow bg-card border-border">
      <CardContent className="p-5 flex flex-col justify-between h-full min-h-[130px]">
        <div className="flex items-start justify-between mb-2">
          <p className="text-sm font-medium text-muted-foreground mr-2 leading-tight">{title}</p>
          <div className="p-2 bg-muted/50 rounded-lg shrink-0">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
        
        <div className="flex items-end justify-between gap-4 mt-auto">
          <div className="flex flex-col min-w-0">
            <h3 className="text-2xl font-bold tracking-tight text-foreground break-words">
              {formatValue(kpi.value)}
            </h3>
            <div className="mt-1 flex items-center flex-wrap gap-1 text-xs font-medium">
              <span className={`flex items-center ${growthColor}`}>
                <GrowthIcon className="mr-0.5 h-3.5 w-3.5" />
                {Math.abs(kpi.growth).toFixed(1)}%
              </span>
              <span className="text-muted-foreground font-normal whitespace-nowrap">
                vs anterior
              </span>
            </div>
          </div>
          
          {sparklineData.length > 0 && (
            <div className="h-10 w-16 sm:w-20 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sparklineData}>
                  <Line 
                    type="monotone" 
                    dataKey="value" 
                    stroke={strokeColor} 
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
