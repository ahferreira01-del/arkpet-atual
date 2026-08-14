import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FeedHeaderProps {
  canPost: boolean;
  onNewPost: () => void;
}

export function FeedHeader({ canPost, onNewPost }: FeedHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">Feed da Creche</h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">
          Atualizações e momentos dos pets
        </p>
      </div>
      {canPost && (
        <Button
          onClick={onNewPost}
          className="h-11 rounded-full gap-2 px-5 shadow-sm bg-primary text-primary-foreground hover:bg-primary/90 font-medium transition-all"
        >
          <PlusCircle className="h-5 w-5" />
          <span className="hidden sm:inline">Novo Post</span>
          <span className="sm:hidden">Postar</span>
        </Button>
      )}
    </div>
  );
}
