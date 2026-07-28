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
        <h1 className="text-xl font-bold text-white">Feed da Creche</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Atualizações e momentos dos pets
        </p>
      </div>
      {canPost && (
        <Button
          onClick={onNewPost}
          size="sm"
          className="rounded-full gap-2 shadow-lg shadow-primary/20"
        >
          <PlusCircle className="h-4 w-4" />
          Novo Post
        </Button>
      )}
    </div>
  );
}
