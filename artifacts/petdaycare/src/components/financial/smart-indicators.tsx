import React from "react";
import { useTutorSmartIndicators, useCatalogueSmartIndicators } from "../../hooks/use-financial";
import { TrendingUp, ShoppingBag, Calendar, DollarSign, Package } from "lucide-react";
import { formatCentsToBRL } from "@/lib/money";

export function TutorSmartIndicators({ crecheId, tutorId }: { crecheId: number, tutorId: number | undefined }) {
  const { data: stats, isLoading } = useTutorSmartIndicators(crecheId, tutorId);

  if (isLoading || !stats || !tutorId) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 mb-6">
      <div className="bg-slate-50 border rounded-lg p-3">
        <p className="text-xs text-slate-500 flex items-center"><DollarSign className="w-3 h-3 mr-1" /> Valor Gasto (LTV)</p>
        <p className="font-bold text-lg text-emerald-600">{formatCentsToBRL(stats.totalSpent)}</p>
      </div>
      <div className="bg-slate-50 border rounded-lg p-3">
        <p className="text-xs text-slate-500 flex items-center"><ShoppingBag className="w-3 h-3 mr-1" /> Faturas Pagas</p>
        <p className="font-bold text-lg text-slate-800">{stats.purchaseCount}</p>
      </div>
      <div className="bg-slate-50 border rounded-lg p-3">
        <p className="text-xs text-slate-500 flex items-center"><TrendingUp className="w-3 h-3 mr-1" /> Ticket Médio</p>
        <p className="font-bold text-lg text-slate-800">{formatCentsToBRL(stats.averageTicket)}</p>
      </div>
      <div className="bg-slate-50 border rounded-lg p-3">
        <p className="text-xs text-slate-500 flex items-center"><Calendar className="w-3 h-3 mr-1" /> Última Compra</p>
        <p className="font-bold text-lg text-slate-800">
          {stats.lastPayment ? new Date(stats.lastPayment).toLocaleDateString('pt-BR') : 'N/A'}
        </p>
      </div>
    </div>
  );
}

export function CatalogueSmartIndicators({ crecheId, itemId, type }: { crecheId: number, itemId: number | undefined, type: string }) {
  const { data: stats, isLoading } = useCatalogueSmartIndicators(crecheId, itemId);

  if (isLoading || !stats || !itemId) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2 mb-6">
      <div className="bg-slate-50 border rounded-lg p-3">
        <p className="text-xs text-slate-500 flex items-center"><DollarSign className="w-3 h-3 mr-1" /> Receita Gerada</p>
        <p className="font-bold text-lg text-emerald-600">{formatCentsToBRL(stats.revenue)}</p>
      </div>
      <div className="bg-slate-50 border rounded-lg p-3">
        <p className="text-xs text-slate-500 flex items-center"><Package className="w-3 h-3 mr-1" /> Qtd. Vendida</p>
        <p className="font-bold text-lg text-slate-800">{stats.quantitySold}</p>
      </div>
      <div className="bg-slate-50 border rounded-lg p-3">
        <p className="text-xs text-slate-500 flex items-center"><TrendingUp className="w-3 h-3 mr-1" /> Ticket Médio</p>
        <p className="font-bold text-lg text-slate-800">{formatCentsToBRL(stats.averageTicket)}</p>
      </div>
      <div className="bg-slate-50 border rounded-lg p-3">
        <p className="text-xs text-slate-500 flex items-center"><Calendar className="w-3 h-3 mr-1" /> Última Venda</p>
        <p className="font-bold text-lg text-slate-800">
          {stats.lastSale ? new Date(stats.lastSale).toLocaleDateString('pt-BR') : 'N/A'}
        </p>
      </div>
    </div>
  );
}
