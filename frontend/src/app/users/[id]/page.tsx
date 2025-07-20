"use client";

import { use, useEffect, useState } from "react";
import { getUser } from "@/api/users";
import type { User } from "@/api/model";
import { notFound } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";

type Props = { params: Promise<{ id: string }> };

export default function UserDetailPage({ params }: Props) {
  const ready = useRequireLogin();
  const { id } = use(params);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let canceled = false;
    setLoading(true);
    setError(null);
    getUser(id)
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
  }, [id, ready]);

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
    <main className="max-w-xl mx-auto mt-10 p-6 bg-white shadow rounded">
      <h1 className="text-2xl font-bold mb-4">{user.nickname}</h1>
      <div className="mb-2">
        <b>Email:</b> {user.email}
      </div>
      <div className="mb-2">
        <b>Introduction:</b> {user.introduction}
      </div>
      <div className="mb-2">
        <b>Personality:</b> {user.personality}
      </div>
      <div className="mb-2">
        <b>Model:</b> {user.model}
      </div>
      <div className="text-xs text-gray-500 mb-4">
        Created: {new Date(user.created_at).toLocaleString()}
        {user.is_admin && (
          <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-600 rounded text-xs">admin</span>
        )}
      </div>
    </main>
  );
}
