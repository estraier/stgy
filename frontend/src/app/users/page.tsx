"use client";

import { useEffect, useState } from "react";
import { listUsers } from "@/api/users";
import type { User } from "@/api/model";
import { useRouter } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";

export default function UsersPage() {
  const ready = useRequireLogin();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    let canceled = false;
    setLoading(true);
    setError(null);
    listUsers()
      .then((data) => {
        if (!canceled) setUsers(data);
      })
      .catch((err: any) => {
        if (!canceled) {
          setError(err.message || "Failed to fetch users.");
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [ready]); // readyがtrueになったときだけデータ取得

  if (!ready) return null;

  return (
    <main className="max-w-2xl mx-auto mt-10 p-6 bg-white shadow rounded">
      <h2 className="text-xl font-bold mb-4 text-center">Users</h2>
      {loading && <div className="text-gray-500">Loading…</div>}
      {error && <div className="text-red-600">{error}</div>}
      <ul className="space-y-4">
        {users.map((user) => (
          <li
            key={user.id}
            className="p-4 border rounded shadow-sm hover:bg-gray-50 cursor-pointer"
            onClick={() => router.push(`/users/${user.id}`)}
          >
            <div className="font-semibold">
              {user.nickname} ({user.email})
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Created: {new Date(user.created_at).toLocaleString()}
              {user.is_admin && (
                <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-600 rounded text-xs">
                  admin
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {users.length === 0 && !loading && !error && (
        <div className="text-gray-500 text-center">No users found.</div>
      )}
    </main>
  );
}
