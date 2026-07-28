import { useState, useRef, useEffect } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useDeletePost } from "../hooks/use-delete-post";

interface FeedCardMenuProps {
  postId: number;
  crecheId: number;
}

export function FeedCardMenu({ postId, crecheId }: FeedCardMenuProps) {
  const [open, setOpen]       = useState(false);
  const menuRef               = useRef<HTMLDivElement>(null);
  const deleteMutation        = useDeletePost(crecheId);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleDelete = () => {
    if (!window.confirm("Tem certeza que deseja excluir esta publicação?")) return;
    setOpen(false);
    deleteMutation.mutate(postId);
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
        title="Opções"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-44 bg-card border border-white/10 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            {deleteMutation.isPending ? "Excluindo…" : "Excluir publicação"}
          </button>
        </div>
      )}
    </div>
  );
}
