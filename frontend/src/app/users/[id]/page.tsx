"use client";

import { use, useEffect, useState } from "react";
import { getUserDetail } from "@/api/users";
import type { UserDetail } from "@/api/models";
import { notFound } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import UserCard from "@/components/UserCard";
import UserEditForm from "@/components/UserEditForm";

type Props = { params: Promise<{ id: string }> };

export default function UserDetailPage({ params }: Props) {
  const ready = useRequireLogin();
  const { id } = use(params);
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);


  const userId = ready && ready.state === "authenticated" ? ready.session.user_id : "";
  const isAdmin = ready && ready.state === "authenticated" && ready.session.user_is_admin;
  const isSelf = user && ready && ready.state === "authenticated" && user.id === userId;

  useEffect(() => {
    if (!ready) return;
    console.log(userId);
    console.log(isAdmin);
    console.log(ready.session);
    let canceled = false;
    setLoading(true);
    setError(null);
    getUserDetail(id, userId)
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
  }, [id, ready, userId]);

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

  const canEdit = isSelf || isAdmin;

  return (
    <main className="max-w-3xl mx-auto mt-8 p-4">
      <UserCard
        user={user}
        truncated={false}
        focusUserId={userId}
        className="shadow-none border-none p-0"
      />
      {canEdit && !editing && (
        <div className="mt-4 flex justify-end">
          <button
            className="px-4 py-1 rounded border bg-sky-100 text-gray-700 hover:bg-sky-200 transition"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        </div>
      )}
      {canEdit && editing && (
        <div className="mt-4">
          <UserEditForm
            user={user}
            isAdmin={isAdmin}
            isSelf={isSelf}
            onUpdated={(updatedUser) => {
              setUser(updatedUser);  // ★ ここで即時反映！
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </main>
  );
}
