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
        className="h-11 w-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        title="Opções"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-48 bg-popover border border-border rounded-xl shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="w-full flex items-center gap-3 px-4 min-h-[44px] text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            {deleteMutation.isPending ? "Excluindo…" : "Excluir publicação"}
          </button>
        </div>
      )}
    </div>
  );
}
