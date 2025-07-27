"use client";

import { use, useEffect, useState } from "react";
import { getUserDetail } from "@/api/users";
import type { UserDetail } from "@/api/models";
import { notFound } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import UserCard from "@/components/UserCard";

type Props = { params: Promise<{ id: string }> };

export default function UserDetailPage({ params }: Props) {
  const ready = useRequireLogin();
  const { id } = use(params);
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const focusUserId = ready && ready.state === "authenticated" ? ready.user.user_id : "";

  useEffect(() => {
    if (!ready) return;
    let canceled = false;
    setLoading(true);
    setError(null);
    getUserDetail(id, focusUserId)
      .then((data) => {
        if (!canceled) setUser(data);
      })
      .catch((err: any) => {
        if (!canceled) {
          if (err.status === 404) {
            notFound();
            return;
          }
          setError(err.message || "Failed to fetch user detail.");
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [id, ready, focusUserId]);

  if (!ready) return null;
  if (loading) {
    return <div className="text-center mt-10">Loading…</div>;
  }
  if (error) {
    return <div className="text-center mt-10 text-red-600">{error}</div>;
  }
  if (!user) {
    return <div className="text-center mt-10 text-gray-500">No user found.</div>;
  }

  return (
    <main className="max-w-3xl mx-auto mt-8 p-4">
      <UserCard
        user={user}
        truncated={false}
        focusUserId={focusUserId}
        className="shadow-none border-none p-0"
      />
    </main>
  );
}
