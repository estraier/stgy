"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { deserializeMdNodes, mdRenderText, mdStripRubyElements } from "stgy-markdown";
import { getSessionInfo } from "@/api/auth";
import type { Post, SessionInfo, User } from "@/api/models";
import { deletePost, listPosts } from "@/api/posts";
import { createUser, deleteUser, getUser, listUsers, updateUser, updateUserPassword } from "@/api/users";
import { formatDateTime } from "@/utils/format";

const PAGE_SIZE = 100;
const DIGEST_LENGTH = 150;
const DEFAULT_INTRODUCTION = "brand new user";
const RANDOM_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

type Tab = "posts" | "users";

type PasswordResetResult = {
  id: string;
  email: string;
  nickname: string;
  password: string;
};

function makeDigest(snippet: string): string {
  try {
    const nodes = deserializeMdNodes(snippet);
    const text = mdRenderText(mdStripRubyElements(nodes)).replace(/\s+/g, " ").trim();
    return text.length > DIGEST_LENGTH ? `${text.slice(0, DIGEST_LENGTH)}…` : text;
  } catch {
    return "";
  }
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatDateTime(date);
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function generateRandomPassword(length = 20): string {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(
    values,
    (value) => RANDOM_PASSWORD_ALPHABET[value % RANDOM_PASSWORD_ALPHABET.length],
  ).join("");
}

export default function PageBody() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("posts");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoaded, setPostsLoaded] = useState(false);
  const [postsHasMore, setPostsHasMore] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());

  const [users, setUsers] = useState<User[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [usersHasMore, setUsersHasMore] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUserId, setNewUserId] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserIntroduction, setNewUserIntroduction] = useState(DEFAULT_INTRODUCTION);
  const [passwordResetResults, setPasswordResetResults] = useState<PasswordResetResult[] | null>(null);
  const [copiedResetUserId, setCopiedResetUserId] = useState<string | null>(null);

  const loadPostsFromStart = useCallback(async (visibleLimit = PAGE_SIZE) => {
    const rows = await listPosts({ order: "desc", limit: visibleLimit + 1 });
    setPosts(rows.slice(0, visibleLimit));
    setPostsHasMore(rows.length > visibleLimit);
    setPostsLoaded(true);
  }, []);

  const loadUsersFromStart = useCallback(async (visibleLimit = PAGE_SIZE) => {
    const rows = await listUsers({ order: "desc", limit: visibleLimit + 1 });
    setUsers(rows.slice(0, visibleLimit));
    setUsersHasMore(rows.length > visibleLimit);
    setUsersLoaded(true);
  }, []);

  useEffect(() => {
    let canceled = false;
    getSessionInfo()
      .then(async (s) => {
        if (canceled) return;
        setSession(s);
        if (!s.userIsAdmin) {
          setLoading(false);
          return;
        }
        try {
          await loadPostsFromStart();
        } catch (e) {
          if (!canceled) setError(e ? String(e) : "Failed to load posts.");
        } finally {
          if (!canceled) setLoading(false);
        }
      })
      .catch(() => {
        if (!canceled) {
          setSession(null);
          setLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [loadPostsFromStart]);

  async function selectTab(next: Tab) {
    setTab(next);
    setError(null);
    if (!session?.userIsAdmin) return;
    if (next === "posts" && !postsLoaded) {
      setBusy(true);
      try {
        await loadPostsFromStart();
      } catch (e) {
        setError(e ? String(e) : "Failed to load posts.");
      } finally {
        setBusy(false);
      }
    } else if (next === "users" && !usersLoaded) {
      setBusy(true);
      try {
        await loadUsersFromStart();
      } catch (e) {
        setError(e ? String(e) : "Failed to load users.");
      } finally {
        setBusy(false);
      }
    }
  }

  async function loadMorePosts() {
    if (busy || !postsHasMore || posts.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await listPosts({
        order: "desc",
        limit: PAGE_SIZE + 1,
        after: posts[posts.length - 1].id,
      });
      setPosts((current) => [...current, ...rows.slice(0, PAGE_SIZE)]);
      setPostsHasMore(rows.length > PAGE_SIZE);
    } catch (e) {
      setError(e ? String(e) : "Failed to load more posts.");
    } finally {
      setBusy(false);
    }
  }

  async function loadMoreUsers() {
    if (busy || !usersHasMore || users.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await listUsers({
        order: "desc",
        limit: PAGE_SIZE + 1,
        after: users[users.length - 1].id,
      });
      setUsers((current) => [...current, ...rows.slice(0, PAGE_SIZE)]);
      setUsersHasMore(rows.length > PAGE_SIZE);
    } catch (e) {
      setError(e ? String(e) : "Failed to load more users.");
    } finally {
      setBusy(false);
    }
  }

  function togglePost(id: string) {
    setSelectedPosts((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleUser(id: string) {
    setSelectedUsers((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onDeletePosts() {
    const ids = Array.from(selectedPosts);
    if (ids.length === 0 || busy) return;
    if (!window.confirm(`Delete ${ids.length} selected ${plural(ids.length, "post")}?`)) return;
    setBusy(true);
    setError(null);
    try {
      for (const id of ids) {
        await deletePost(id);
      }
      setSelectedPosts(new Set());
      await loadPostsFromStart(Math.max(PAGE_SIZE, posts.length));
    } catch (e) {
      setError(e ? String(e) : "Failed to delete posts.");
      setSelectedPosts(new Set());
      try {
        await loadPostsFromStart(Math.max(PAGE_SIZE, posts.length));
      } catch {
        // Keep the original operation error.
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteUsers() {
    const ids = Array.from(selectedUsers);
    if (ids.length === 0 || busy) return;
    if (session && ids.includes(session.userId)) {
      setError("You cannot delete yourself.");
      return;
    }
    if (!window.confirm(`Delete ${ids.length} selected ${plural(ids.length, "user")}?`)) return;
    setBusy(true);
    setError(null);
    try {
      for (const id of ids) {
        await deleteUser(id);
      }
      setSelectedUsers(new Set());
      setPosts([]);
      setPostsHasMore(false);
      setPostsLoaded(false);
      setSelectedPosts(new Set());
      await loadUsersFromStart(Math.max(PAGE_SIZE, users.length));
    } catch (e) {
      setError(e ? String(e) : "Failed to delete users.");
      setSelectedUsers(new Set());
      try {
        await loadUsersFromStart(Math.max(PAGE_SIZE, users.length));
      } catch {
        // Keep the original operation error.
      }
      setPosts([]);
      setPostsHasMore(false);
      setPostsLoaded(false);
      setSelectedPosts(new Set());
    } finally {
      setBusy(false);
    }
  }

  async function onFreezeUsers() {
    const ids = Array.from(selectedUsers);
    if (ids.length === 0 || busy) return;
    if (!window.confirm(`Freeze ${ids.length} selected ${plural(ids.length, "user")}?`)) return;
    const selfId = session?.userId;
    const orderedIds = selfId && ids.includes(selfId)
      ? [...ids.filter((id) => id !== selfId), selfId]
      : ids;
    setBusy(true);
    setError(null);
    try {
      for (const id of orderedIds) {
        const updated = await updateUser(id, { isFrozen: true });
        if (!updated.isFrozen) {
          throw new Error(`User ${id} was not frozen.`);
        }
      }
      setSelectedUsers(new Set());
      if (selfId && ids.includes(selfId)) {
        window.location.assign("/");
        return;
      }
      await loadUsersFromStart(Math.max(PAGE_SIZE, users.length));
    } catch (e) {
      setError(e ? String(e) : "Failed to freeze users.");
      setSelectedUsers(new Set());
      try {
        await loadUsersFromStart(Math.max(PAGE_SIZE, users.length));
      } catch {
        // Keep the original operation error.
      }
    } finally {
      setBusy(false);
    }
  }

  async function onResetUserPasswords() {
    if (selectedUsers.size === 0 || busy) return;
    const ids = users.filter((user) => selectedUsers.has(user.id)).map((user) => user.id);
    if (ids.length === 0) return;
    if (!window.confirm(`Reset passwords for ${ids.length} selected ${plural(ids.length, "user")}?`)) return;

    setBusy(true);
    setError(null);
    setCopiedResetUserId(null);

    const results: PasswordResetResult[] = [];
    const failures: string[] = [];
    for (const id of ids) {
      try {
        const detail = await getUser(id);
        const password = generateRandomPassword();
        await updateUserPassword(id, password);
        results.push({
          id,
          email: detail.email,
          nickname: detail.nickname,
          password,
        });
      } catch (e) {
        failures.push(`${id}: ${e ? String(e) : "Password reset failed."}`);
      }
    }

    setSelectedUsers(new Set());
    setPasswordResetResults(results);
    if (failures.length > 0) {
      setError(
        `Failed to reset ${failures.length} ${plural(failures.length, "user")}: ${failures.join("; ")}`,
      );
    }
    setBusy(false);
  }

  async function copyPasswordResetResult(result: PasswordResetResult) {
    const text =
      `User ID: ${result.id}\n` +
      `E-mail address: ${result.email}\n` +
      `Nickname: ${result.nickname}\n` +
      `New password: ${result.password}\n`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedResetUserId(result.id);
      window.setTimeout(() => {
        setCopiedResetUserId((current) => (current === result.id ? null : current));
      }, 1500);
    } catch (e) {
      setError(e ? String(e) : "Failed to copy to clipboard.");
    }
  }

  function closePasswordResetResults() {
    if (busy) return;
    setError(null);
    setCopiedResetUserId(null);
    setPasswordResetResults(null);
  }

  function startCreateUser() {
    setError(null);
    setPasswordResetResults(null);
    setSelectedUsers(new Set());
    setNewUserId("");
    setNewUserEmail("");
    setNewUserPassword("");
    setNewUserIntroduction(DEFAULT_INTRODUCTION);
    setCreatingUser(true);
  }

  function cancelCreateUser() {
    if (busy) return;
    setError(null);
    setCreatingUser(false);
  }

  async function onCreateUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !session) return;

    const id = newUserId.trim();
    const email = newUserEmail.trim();
    const password = newUserPassword;
    const introduction = newUserIntroduction;

    if (id !== "" && !/^[0-9A-Fa-f]{16}$/.test(id)) {
      setError("ID must be exactly 16 hexadecimal digits.");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Invalid email address.");
      return;
    }
    if (password.trim() === "") {
      setError("Password is required.");
      return;
    }
    if (introduction.trim() === "") {
      setError("Introduction is required.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const normalizedEmail = email.toLowerCase();
      await createUser({
        id: id === "" ? undefined : id.toUpperCase(),
        email: normalizedEmail,
        nickname: normalizedEmail.split("@")[0],
        password,
        isAdmin: false,
        blockStrangers: false,
        locale: session.userLocale || "en-US",
        timezone: session.userTimezone || "UTC",
        introduction,
        avatar: null,
        aiModel: null,
        aiPersonality: null,
      });
      setCreatingUser(false);
      setSelectedUsers(new Set());
      try {
        await loadUsersFromStart(Math.max(PAGE_SIZE, users.length + 1));
      } catch (e) {
        setError(
          e
            ? `User was created, but failed to refresh the list: ${String(e)}`
            : "User was created, but failed to refresh the list.",
        );
      }
    } catch (e) {
      setError(e ? String(e) : "Failed to create user.");
    } finally {
      setBusy(false);
    }
  }

  const selectedUsersContainSelf = Boolean(
    session && selectedUsers.has(session.userId),
  );

  const postDigests = useMemo(
    () => new Map(posts.map((post) => [post.id, makeDigest(post.snippet)])),
    [posts],
  );
  const userDigests = useMemo(
    () => new Map(users.map((user) => [user.id, makeDigest(user.snippet)])),
    [users],
  );

  const buttonBase =
    "px-3 py-1.5 rounded border text-sm whitespace-nowrap transition-colors cursor-pointer " +
    "disabled:opacity-40 disabled:cursor-not-allowed";
  const dangerButton = `${buttonBase} border-red-300 text-red-700 bg-white hover:bg-red-50`;
  const neutralButton = `${buttonBase} border-gray-300 text-gray-800 bg-white hover:bg-gray-50`;
  const primaryButton = `${buttonBase} border-blue-600 text-white bg-blue-600 hover:bg-blue-700`;

  if (loading) {
    return <main className="max-w-6xl mx-auto mt-12 p-4">Loading...</main>;
  }
  if (!session) {
    return <main className="max-w-6xl mx-auto mt-12 p-4">Login required.</main>;
  }
  if (!session.userIsAdmin) {
    return <main className="max-w-6xl mx-auto mt-12 p-4">Administrator access required.</main>;
  }

  return (
    <main className="max-w-6xl mx-auto mt-8 p-4">
      <div className="bg-white border rounded shadow p-4">
        <h1 className="text-2xl font-bold mb-4">Contents Dashboard</h1>

        <div className="flex border-b mb-4">
          <button
            type="button"
            className={`px-4 py-2 text-sm cursor-pointer border-b-2 ${
              tab === "posts"
                ? "border-blue-600 text-blue-700 font-semibold"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
            onClick={() => void selectTab("posts")}
          >
            Posts
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm cursor-pointer border-b-2 ${
              tab === "users"
                ? "border-blue-600 text-blue-700 font-semibold"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
            onClick={() => void selectTab("users")}
          >
            Users
          </button>
        </div>

        {error && <div className="mb-3 text-sm text-red-700">{error}</div>}

        {tab === "posts" ? (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                className={dangerButton}
                disabled={busy || selectedPosts.size === 0}
                onClick={() => void onDeletePosts()}
              >
                Delete
              </button>
              <span className="text-xs text-gray-500">
                {selectedPosts.size > 0 ? `${selectedPosts.size} selected` : `${posts.length} shown`}
              </span>
            </div>

            <div className="border rounded overflow-auto max-h-[calc(100vh-15rem)] min-h-[18rem]">
              <table className="w-full min-w-[1100px] border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-gray-100 border-b">
                  <tr className="text-left">
                    <th className="px-3 py-2 whitespace-nowrap">Post ID</th>
                    <th className="px-3 py-2 whitespace-nowrap">Created at</th>
                    <th className="px-3 py-2 whitespace-nowrap">User ID</th>
                    <th className="px-3 py-2 whitespace-nowrap">Nickname</th>
                    <th className="px-3 py-2 w-full">Digest</th>
                    <th className="w-14 min-w-14 pl-2 pr-6 py-2 text-center"></th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((post) => (
                    <tr key={post.id} className="border-b last:border-b-0 hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        <Link href={`/posts/${post.id}`} className="text-black hover:underline">
                          {post.id}
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatCreatedAt(post.createdAt)}</td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{post.ownedBy}</td>
                      <td className="px-3 py-2 whitespace-nowrap max-w-[16rem] truncate" title={post.ownerNickname}>
                        {post.ownerNickname}
                      </td>
                      <td className="px-3 py-2 text-gray-700 break-words">{postDigests.get(post.id)}</td>
                      <td className="w-14 min-w-14 pl-2 pr-6 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedPosts.has(post.id)}
                          onChange={() => togglePost(post.id)}
                          aria-label={`Select post ${post.id}`}
                          className="cursor-pointer"
                        />
                      </td>
                    </tr>
                  ))}
                  {postsLoaded && posts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                        No posts.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {postsHasMore && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  className={neutralButton}
                  disabled={busy}
                  onClick={() => void loadMorePosts()}
                >
                  more
                </button>
              </div>
            )}
          </section>
        ) : (
          <section>
            {creatingUser ? (
              <form onSubmit={(e) => void onCreateUser(e)} className="max-w-2xl">
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="new-user-id"
                      className="block mb-1 text-sm font-medium text-gray-700"
                    >
                      ID
                    </label>
                    <input
                      id="new-user-id"
                      type="text"
                      value={newUserId}
                      onChange={(e) => {
                        setNewUserId(e.target.value);
                        setError(null);
                      }}
                      placeholder="Leave blank to assign automatically"
                      pattern="[0-9A-Fa-f]{16}"
                      maxLength={16}
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full px-3 py-2 border rounded font-mono"
                    />
                    <div className="mt-1 text-xs text-gray-500">
                      Optional. If specified, enter exactly 16 hexadecimal digits.
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="new-user-email"
                      className="block mb-1 text-sm font-medium text-gray-700"
                    >
                      Email address
                    </label>
                    <input
                      id="new-user-email"
                      type="email"
                      value={newUserEmail}
                      onChange={(e) => {
                        setNewUserEmail(e.target.value);
                        setError(null);
                      }}
                      required
                      autoComplete="off"
                      className="w-full px-3 py-2 border rounded"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="new-user-password"
                      className="block mb-1 text-sm font-medium text-gray-700"
                    >
                      Password
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="new-user-password"
                        type="text"
                        value={newUserPassword}
                        onChange={(e) => {
                          setNewUserPassword(e.target.value);
                          setError(null);
                        }}
                        required
                        autoComplete="new-password"
                        spellCheck={false}
                        className="flex-1 min-w-0 px-3 py-2 border rounded font-mono"
                      />
                      <button
                        type="button"
                        className={neutralButton}
                        disabled={busy}
                        onClick={() => {
                          setNewUserPassword(generateRandomPassword());
                          setError(null);
                        }}
                      >
                        Generate
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="new-user-introduction"
                      className="block mb-1 text-sm font-medium text-gray-700"
                    >
                      Introduction
                    </label>
                    <textarea
                      id="new-user-introduction"
                      value={newUserIntroduction}
                      onChange={(e) => {
                        setNewUserIntroduction(e.target.value);
                        setError(null);
                      }}
                      rows={6}
                      required
                      className="w-full px-3 py-2 border rounded resize-y"
                    />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button type="submit" className={primaryButton} disabled={busy}>
                      Create
                    </button>
                    <button
                      type="button"
                      className={neutralButton}
                      disabled={busy}
                      onClick={cancelCreateUser}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            ) : passwordResetResults !== null ? (
              <>
                <div className="flex items-center mb-3">
                  <button
                    type="button"
                    className={neutralButton}
                    disabled={busy}
                    onClick={closePasswordResetResults}
                  >
                    OK
                  </button>
                  <span className="ml-3 text-xs text-gray-500">
                    {passwordResetResults.length} password{" "}
                    {passwordResetResults.length === 1 ? "reset" : "resets"}
                  </span>
                </div>

                <div className="border rounded overflow-auto max-h-[calc(100vh-15rem)] min-h-[18rem]">
                  <table className="w-full min-w-[900px] border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-gray-100 border-b">
                      <tr className="text-left">
                        <th className="px-3 py-2 whitespace-nowrap">User ID</th>
                        <th className="px-3 py-2 whitespace-nowrap">E-mail address</th>
                        <th className="px-3 py-2 whitespace-nowrap">Nickname</th>
                        <th className="px-3 py-2 whitespace-nowrap">New password</th>
                        <th className="px-3 py-2 w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {passwordResetResults.map((result) => (
                        <tr key={result.id} className="border-b last:border-b-0">
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                            {result.id}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">{result.email}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{result.nickname}</td>
                          <td className="px-3 py-2 font-mono whitespace-nowrap">{result.password}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              className={neutralButton}
                              onClick={() => void copyPasswordResetResult(result)}
                            >
                              {copiedResetUserId === result.id ? "Copied" : "Copy"}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {passwordResetResults.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                            No passwords were reset.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <button
                    type="button"
                    className={dangerButton}
                    disabled={busy || selectedUsers.size === 0 || selectedUsersContainSelf}
                    onClick={() => void onDeleteUsers()}
                    title={selectedUsersContainSelf ? "You cannot delete yourself." : undefined}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className={neutralButton}
                    disabled={busy || selectedUsers.size === 0}
                    onClick={() => void onFreezeUsers()}
                  >
                    Freeze
                  </button>
                  <button
                    type="button"
                    className={neutralButton}
                    disabled={busy || selectedUsers.size === 0}
                    onClick={() => void onResetUserPasswords()}
                  >
                    Reset password
                  </button>
                  <span className="text-xs text-gray-500">
                    {selectedUsersContainSelf
                      ? "You cannot delete yourself."
                      : selectedUsers.size > 0
                        ? `${selectedUsers.size} selected`
                        : `${users.length} shown`}
                  </span>
                  <button
                    type="button"
                    className={`${neutralButton} ml-auto`}
                    disabled={busy}
                    onClick={startCreateUser}
                  >
                    Create
                  </button>
                </div>

                <div className="border rounded overflow-auto max-h-[calc(100vh-15rem)] min-h-[18rem]">
                  <table className="w-full min-w-[1000px] border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-gray-100 border-b">
                      <tr className="text-left">
                        <th className="px-3 py-2 whitespace-nowrap">User ID</th>
                        <th className="px-3 py-2 whitespace-nowrap">Registered at</th>
                        <th className="px-3 py-2 whitespace-nowrap">Nickname</th>
                        <th className="px-3 py-2 whitespace-nowrap">Flags</th>
                        <th className="px-3 py-2 w-full">Profile</th>
                        <th className="px-3 py-2 text-center"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id} className="border-b last:border-b-0 hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                            <Link href={`/users/${user.id}`} className="text-black hover:underline">
                              {user.id}
                            </Link>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatCreatedAt(user.createdAt)}
                          </td>
                          <td
                            className="px-3 py-2 whitespace-nowrap max-w-[16rem] truncate"
                            title={user.nickname}
                          >
                            {user.nickname}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="flex flex-wrap gap-1">
                              {user.isAdmin && (
                                <span className="px-1.5 py-0.5 rounded border border-purple-300 bg-purple-50 text-purple-700 text-[10px] font-semibold">
                                  Admin
                                </span>
                              )}
                              {user.aiModel !== null && (
                                <span className="px-1.5 py-0.5 rounded border border-blue-300 bg-blue-50 text-blue-700 text-[10px] font-semibold">
                                  AI
                                </span>
                              )}
                              {user.isFrozen && (
                                <span className="px-1.5 py-0.5 rounded border border-gray-400 bg-gray-100 text-gray-700 text-[10px] font-semibold">
                                  Frozen
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-gray-700 break-words">
                            {userDigests.get(user.id)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={selectedUsers.has(user.id)}
                              onChange={() => toggleUser(user.id)}
                              aria-label={`Select user ${user.id}`}
                              className="cursor-pointer"
                            />
                          </td>
                        </tr>
                      ))}
                      {usersLoaded && users.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                            No users.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {usersHasMore && (
                  <div className="mt-3 flex justify-center">
                    <button
                      type="button"
                      className={neutralButton}
                      disabled={busy}
                      onClick={() => void loadMoreUsers()}
                    >
                      more
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
