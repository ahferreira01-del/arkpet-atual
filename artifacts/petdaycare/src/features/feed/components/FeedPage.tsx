import { useState, useMemo } from "react";
import { useListPets } from "@workspace/api-client-react";
import { FeedHeader } from "./FeedHeader";
import { FeedFilters } from "./FeedFilters";
import { FeedList } from "./FeedList";
import { CreatePostModal } from "./CreatePostModal";
import { useFeed } from "../hooks/use-feed";
import type { TaggablePet } from "../types/feed.types";

interface FeedPageProps {
  crecheId: number;
  userRole: string;
  userId: number;
}

export function FeedPage({ crecheId, userRole, userId }: FeedPageProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [petFilter,  setPetFilter]  = useState("all");

  const canPost = userRole === "staff" || userRole === "creche_admin";

  // Feed data
  const {
    data,
    isLoading,
    isError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = useFeed(crecheId);

  // Pets for filters and pet-selector in the create modal
  const { data: petsData } = useListPets(crecheId);
  const allPets: Array<{ id: number; name: string; breed: string | null; species: string | null; isCheckedIn: boolean }> =
    (petsData as any)?.items ?? [];

  const checkedInPets: TaggablePet[] = allPets
    .filter((p) => p.isCheckedIn)
    .map((p) => ({ id: p.id, name: p.name, breed: p.breed, species: p.species }));

  // Flatten all pages into a single post list
  const allPosts = useMemo(
    () => data?.pages.flatMap((page) => page.posts) ?? [],
    [data],
  );

  // Client-side filtering (avoids extra API calls for quick filter changes)
  const filteredPosts = useMemo(
    () =>
      allPosts.filter((post) => {
        if (typeFilter !== "all" && post.type !== typeFilter) return false;
        if (petFilter  !== "all") {
          const hasPet = post.pets.some((p) => String(p.petId) === petFilter);
          if (!hasPet) return false;
        }
        return true;
      }),
    [allPosts, typeFilter, petFilter],
  );

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <FeedHeader canPost={canPost} onNewPost={() => setShowCreate(true)} />

      {/* Filters */}
      <FeedFilters
        typeFilter={typeFilter}
        petFilter={petFilter}
        pets={allPets}
        onTypeChange={setTypeFilter}
        onPetChange={setPetFilter}
      />

      {/* Feed list */}
      <FeedList
        posts={filteredPosts}
        isLoading={isLoading}
        isError={isError}
        hasNextPage={!!hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        crecheId={crecheId}
        userRole={userRole}
        userId={userId}
        onRetry={refetch}
        onLoadMore={fetchNextPage}
      />

      {/* Create post modal */}
      {showCreate && (
        <CreatePostModal
          crecheId={crecheId}
          checkedInPets={checkedInPets}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
