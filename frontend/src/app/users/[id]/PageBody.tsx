"use client";

import { Config } from "@/config";
import { useEffect, useState, useCallback, useRef } from "react";
import { getUser, listFollowers, listFollowees } from "@/api/users";
import { listPosts, addLike, removeLike, createPost } from "@/api/posts";
import {
  getAiUserInterest,
  listAiPeerImpressions,
  listAiPostImpressions,
} from "@/api/aiUser";
import type {
  AiPeerImpression,
  AiPostImpression,
  AiUserInterest,
  User,
  UserDetail,
  Post,
} from "@/api/models";
import { notFound, useParams, useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import UserCard from "@/components/UserCard";
import UserForm from "@/components/UserForm";
import PostCard from "@/components/PostCard";
import PostForm from "@/components/PostForm";
import { makePostIdFromDateString, parseBodyAndTags } from "@/utils/parse";
import { formatDateTime } from "@/utils/format";

const TAB_VALUES = ["posts", "replies", "followers", "followees"] as const;
const AI_TAB_VALUES = ["posts", "users", "interest"] as const;

type ParsedImpressionPayload = {
  impression: string | null;
  tags: string[];
  shouldFollow?: boolean;
  shouldLike?: boolean;
  shouldReply?: boolean;
};

function parseImpressionPayload(payload: string): ParsedImpressionPayload | null {
  try {
    const value = JSON.parse(payload) as unknown;
    if (!value || typeof value !== "object") return null;
    const obj = value as Record<string, unknown>;
    return {
      impression: typeof obj.impression === "string" ? obj.impression : null,
      tags: Array.isArray(obj.tags)
        ? obj.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      ...(typeof obj.shouldFollow === "boolean" ? { shouldFollow: obj.shouldFollow } : {}),
      ...(typeof obj.shouldLike === "boolean" ? { shouldLike: obj.shouldLike } : {}),
      ...(typeof obj.shouldReply === "boolean" ? { shouldReply: obj.shouldReply } : {}),
    };
  } catch {
    return null;
  }
}

function ImpressionPayloadView({
  payload,
  kind,
}: {
  payload: string;
  kind: "posts" | "users";
}) {
  const parsed = parseImpressionPayload(payload);
  if (!parsed) {
    return <div className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{payload}</div>;
  }
  const decisions: Array<[string, boolean | undefined]> =
    kind === "posts"
      ? [
          ["like", parsed.shouldLike],
          ["reply", parsed.shouldReply],
        ]
      : [["follow", parsed.shouldFollow]];
  return (
    <div className="mt-2">
      {parsed.impression && (
        <div className="whitespace-pre-wrap text-sm text-gray-800">{parsed.impression}</div>
      )}
      {(parsed.tags.length > 0 || decisions.some(([, value]) => typeof value === "boolean")) && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {parsed.tags.map((tag) => (
            <span key={tag} className="rounded bg-gray-100 px-2 py-0.5 text-blue-700">
              #{tag}
            </span>
          ))}
          {decisions.map(([label, value]) =>
            typeof value === "boolean" ? (
              <span key={String(label)} className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
                {String(label)}: {value ? "yes" : "no"}
              </span>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}


const RESTORE_POST_ID_KEY = "lastPostId";
const RESTORE_POST_PAGE_KEY = "lastPostPage";
const RESTORE_USER_ID_KEY = "lastUserId";
const RESTORE_USER_PAGE_KEY = "lastUserPage";

export default function PageBody() {
  const params = useParams();
  const id =
    typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";

  const status = useRequireLogin();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const userId = status && status.state === "authenticated" ? status.session.userId : "";
  const isAdmin = status && status.state === "authenticated" && status.session.userIsAdmin;
  const updatedAt = status.state === "authenticated" ? status.session.userUpdatedAt : null;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const tabsRef = useRef<HTMLDivElement | null>(null);
  const tabsPrecedingContentRef = useRef<HTMLDivElement | null>(null);
  const pendingTabScrollRef = useRef(false);
  const initialAiTabScrollActiveRef = useRef(false);

  const scrollTabsToViewportTop10 = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    const absoluteTop = window.scrollY + el.getBoundingClientRect().top;
    const desiredTop = Math.max(0, absoluteTop - window.innerHeight * 0.1);
    window.scrollTo({ top: desiredTop });
  }, []);

  const setQuery = useCallback(
    (
      updates: Partial<{ tab: string; page: number; oldestFirst: string | undefined }>,
      opts?: { scroll?: boolean },
    ) => {
      const sp = new URLSearchParams(searchParams);
      for (const key of ["tab", "page", "oldestFirst"]) {
        const v = updates[key as keyof typeof updates];
        if (v !== undefined && v !== null && v !== "") {
          sp.set(key, String(v));
        } else {
          sp.delete(key);
        }
      }
      const url = `${pathname}?${sp.toString()}`;
      if (opts && opts.scroll === false) {
        router.push(url, { scroll: false });
      } else {
        router.push(url);
      }
    },
    [router, pathname, searchParams],
  );

  const setAiQuery = useCallback(
    (updates: Partial<{ aiTab: string; aiPage: number; aiOldestFirst: string | undefined }>) => {
      const sp = new URLSearchParams(searchParams);
      sp.set("view", "ai-impressions");
      for (const key of ["aiTab", "aiPage", "aiOldestFirst"]) {
        const v = updates[key as keyof typeof updates];
        if (v !== undefined && v !== null && v !== "") {
          sp.set(key, String(v));
        } else {
          sp.delete(key);
        }
      }
      router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  function getQuery() {
    const aiTabParam = searchParams.get("aiTab");
    return {
      tab: (searchParams.get("tab") as (typeof TAB_VALUES)[number]) || "posts",
      oldestFirst: searchParams.get("oldestFirst") === "1",
      page: Math.max(Number(searchParams.get("page")) || 1, 1),
      requestedAiMode: searchParams.get("view") === "ai-impressions",
      aiTab: AI_TAB_VALUES.includes(aiTabParam as (typeof AI_TAB_VALUES)[number])
        ? (aiTabParam as (typeof AI_TAB_VALUES)[number])
        : "posts",
      aiOldestFirst: searchParams.get("aiOldestFirst") === "1",
      aiPage: Math.max(Number(searchParams.get("aiPage")) || 1, 1),
    };
  }
  const { tab, oldestFirst, page, requestedAiMode, aiTab, aiOldestFirst, aiPage } = getQuery();

  const [posts, setPosts] = useState<Post[]>([]);
  const [followers, setFollowers] = useState<User[]>([]);
  const [followees, setFollowees] = useState<User[]>([]);
  const [aiPeerImpressions, setAiPeerImpressions] = useState<AiPeerImpression[]>([]);
  const [aiPostImpressions, setAiPostImpressions] = useState<AiPostImpression[]>([]);
  const [aiInterest, setAiInterest] = useState<AiUserInterest | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);

  const isSelf = !!(user && userId && user.id === userId);
  const isAI = !!(user?.aiModel && user.aiModel.trim() !== "");
  const canViewAiImpressions = isAI && (isSelf || !!isAdmin);
  const aiMode = requestedAiMode && canViewAiImpressions;
  const canEdit = isSelf || isAdmin;

  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySubmitting, setReplySubmitting] = useState(false);

  const [pendingRestore, setPendingRestore] = useState<{
    kind: "post" | "user";
    id: string;
    page: number;
  } | null>(null);

  useEffect(() => {
    if (!status) return;
    let canceled = false;
    setLoading(true);
    setError(null);
    getUser(id, userId)
      .then((data) => {
        if (!canceled) setUser(data);
      })
      .catch((err: unknown) => {
        if (!canceled) {
          if (
            typeof err === "object" &&
            err &&
            "status" in err &&
            (err as { status: unknown }).status === 404
          ) {
            notFound();
            return;
          }
          if (err instanceof Error) setError(err.message || "Failed to fetch user.");
          else setError(String(err) || "Failed to fetch user.");
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [id, status, userId]);

  useEffect(() => {
    if (!user || !user.id) return;
    setListLoading(true);
    setListError(null);

    if (aiMode) {
      if (aiTab === "posts") {
        listAiPostImpressions(user.id, {
          offset: (aiPage - 1) * Config.POSTS_PAGE_SIZE,
          limit: Config.POSTS_PAGE_SIZE + 1,
          order: aiOldestFirst ? "asc" : "desc",
        })
          .then((data) => {
            setAiPostImpressions(data.slice(0, Config.POSTS_PAGE_SIZE));
            setHasNext(data.length > Config.POSTS_PAGE_SIZE);
          })
          .catch((err: unknown) => {
            if (err instanceof Error)
              setListError(err.message || "Failed to fetch post impressions.");
            else setListError(String(err) || "Failed to fetch post impressions.");
          })
          .finally(() => setListLoading(false));
      } else if (aiTab === "users") {
        listAiPeerImpressions(user.id, {
          offset: (aiPage - 1) * Config.USERS_PAGE_SIZE,
          limit: Config.USERS_PAGE_SIZE + 1,
          order: aiOldestFirst ? "asc" : "desc",
        })
          .then((data) => {
            setAiPeerImpressions(data.slice(0, Config.USERS_PAGE_SIZE));
            setHasNext(data.length > Config.USERS_PAGE_SIZE);
          })
          .catch((err: unknown) => {
            if (err instanceof Error)
              setListError(err.message || "Failed to fetch user impressions.");
            else setListError(String(err) || "Failed to fetch user impressions.");
          })
          .finally(() => setListLoading(false));
      } else {
        setHasNext(false);
        getAiUserInterest(user.id)
          .then((data) => setAiInterest(data))
          .catch((err: unknown) => {
            if (err instanceof Error) setListError(err.message || "Failed to fetch interest.");
            else setListError(String(err) || "Failed to fetch interest.");
          })
          .finally(() => setListLoading(false));
      }
      return;
    }

    if (tab === "posts" || tab === "replies") {
      const params: {
        ownedBy: string;
        offset: number;
        limit: number;
        order: "asc" | "desc";
        focusUserId: string;
        replyTo?: string;
      } = {
        ownedBy: user.id,
        offset: (page - 1) * Config.POSTS_PAGE_SIZE,
        limit: Config.POSTS_PAGE_SIZE + 1,
        order: oldestFirst ? "asc" : "desc",
        focusUserId: userId,
      };
      if (tab === "posts") params.replyTo = "";
      if (tab === "replies") params.replyTo = "*";
      listPosts(params)
        .then((data) => {
          setPosts(data.slice(0, Config.POSTS_PAGE_SIZE));
          setHasNext(data.length > Config.POSTS_PAGE_SIZE);
        })
        .catch((err: unknown) => {
          if (err instanceof Error) setListError(err.message || "Failed to fetch posts.");
          else setListError(String(err) || "Failed to fetch posts.");
        })
        .finally(() => setListLoading(false));
    } else if (tab === "followers") {
      listFollowers(user.id, {
        offset: (page - 1) * Config.USERS_PAGE_SIZE,
        limit: Config.USERS_PAGE_SIZE + 1,
        order: oldestFirst ? "asc" : "desc",
        focusUserId: userId,
      })
        .then((data) => {
          setFollowers(data.slice(0, Config.USERS_PAGE_SIZE));
          setHasNext(data.length > Config.USERS_PAGE_SIZE);
        })
        .catch((err: unknown) => {
          if (err instanceof Error) setListError(err.message || "Failed to fetch followers.");
          else setListError(String(err) || "Failed to fetch followers.");
        })
        .finally(() => setListLoading(false));
    } else if (tab === "followees") {
      listFollowees(user.id, {
        offset: (page - 1) * Config.USERS_PAGE_SIZE,
        limit: Config.USERS_PAGE_SIZE + 1,
        order: oldestFirst ? "asc" : "desc",
        focusUserId: userId,
      })
        .then((data) => {
          setFollowees(data.slice(0, Config.USERS_PAGE_SIZE));
          setHasNext(data.length > Config.USERS_PAGE_SIZE);
        })
        .catch((err: unknown) => {
          if (err instanceof Error) setListError(err.message || "Failed to fetch followees.");
          else setListError(String(err) || "Failed to fetch followees.");
        })
        .finally(() => setListLoading(false));
    }
  }, [
    aiMode,
    aiTab,
    aiPage,
    aiOldestFirst,
    tab,
    user?.id,
    page,
    oldestFirst,
    userId,
    user,
  ]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const block = target.closest(".image-block");
      if (block) {
        block.classList.toggle("expanded");
        e.stopPropagation();
      }
    }
    document.body.addEventListener("click", handler);
    return () => {
      document.body.removeEventListener("click", handler);
    };
  }, []);

  useEffect(() => {
    initialAiTabScrollActiveRef.current = !!aiMode;
    if (!aiMode) return;

    const stopInitialAiTabScroll = () => {
      initialAiTabScrollActiveRef.current = false;
    };
    window.addEventListener("wheel", stopInitialAiTabScroll, { passive: true });
    window.addEventListener("touchstart", stopInitialAiTabScroll, { passive: true });
    window.addEventListener("pointerdown", stopInitialAiTabScroll, { passive: true });
    window.addEventListener("keydown", stopInitialAiTabScroll);
    return () => {
      window.removeEventListener("wheel", stopInitialAiTabScroll);
      window.removeEventListener("touchstart", stopInitialAiTabScroll);
      window.removeEventListener("pointerdown", stopInitialAiTabScroll);
      window.removeEventListener("keydown", stopInitialAiTabScroll);
      initialAiTabScrollActiveRef.current = false;
    };
  }, [aiMode, user?.id]);

  useEffect(() => {
    if (loading || !aiMode || !initialAiTabScrollActiveRef.current) return;
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        if (initialAiTabScrollActiveRef.current) scrollTabsToViewportTop10();
      });
    });
    return () => {
      cancelAnimationFrame(frame1);
      if (frame2) cancelAnimationFrame(frame2);
    };
  }, [loading, aiMode, user?.id, scrollTabsToViewportTop10]);

  useEffect(() => {
    if (loading || listLoading || !aiMode || !initialAiTabScrollActiveRef.current) return;
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        if (initialAiTabScrollActiveRef.current) scrollTabsToViewportTop10();
      });
    });
    return () => {
      cancelAnimationFrame(frame1);
      if (frame2) cancelAnimationFrame(frame2);
    };
  }, [loading, listLoading, aiMode, user?.id, scrollTabsToViewportTop10]);

  useEffect(() => {
    if (loading || !aiMode || typeof ResizeObserver === "undefined") return;
    const element = tabsPrecedingContentRef.current;
    if (!element) return;

    let frame1 = 0;
    let frame2 = 0;
    const observer = new ResizeObserver(() => {
      if (!initialAiTabScrollActiveRef.current) return;
      if (frame1) cancelAnimationFrame(frame1);
      if (frame2) cancelAnimationFrame(frame2);
      frame1 = requestAnimationFrame(() => {
        frame2 = requestAnimationFrame(() => {
          if (initialAiTabScrollActiveRef.current) scrollTabsToViewportTop10();
        });
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame1) cancelAnimationFrame(frame1);
      if (frame2) cancelAnimationFrame(frame2);
    };
  }, [loading, aiMode, user?.id, scrollTabsToViewportTop10]);

  useEffect(() => {
    if (!pendingTabScrollRef.current) return;
    pendingTabScrollRef.current = false;
    requestAnimationFrame(() => requestAnimationFrame(scrollTabsToViewportTop10));
  }, [tab, aiTab, aiMode, scrollTabsToViewportTop10]);

  useEffect(() => {
    if (aiMode) return;
    try {
      const st = window.history.state as Record<string, unknown> | null;
      const pid =
        st && typeof st[RESTORE_POST_ID_KEY] === "string"
          ? (st[RESTORE_POST_ID_KEY] as string)
          : null;
      const ppgRaw =
        st && st[RESTORE_POST_PAGE_KEY] !== undefined ? st[RESTORE_POST_PAGE_KEY] : null;
      const ppg =
        typeof ppgRaw === "number"
          ? ppgRaw
          : typeof ppgRaw === "string"
            ? parseInt(ppgRaw, 10)
            : NaN;

      const uid =
        st && typeof st[RESTORE_USER_ID_KEY] === "string"
          ? (st[RESTORE_USER_ID_KEY] as string)
          : null;
      const upgRaw =
        st && st[RESTORE_USER_PAGE_KEY] !== undefined ? st[RESTORE_USER_PAGE_KEY] : null;
      const upg =
        typeof upgRaw === "number"
          ? upgRaw
          : typeof upgRaw === "string"
            ? parseInt(upgRaw, 10)
            : NaN;

      if ((tab === "posts" || tab === "replies") && pid && !Number.isNaN(ppg)) {
        setPendingRestore({ kind: "post", id: pid, page: Math.max(1, (ppg as number) || 1) });
      } else if ((tab === "followers" || tab === "followees") && uid && !Number.isNaN(upg)) {
        setPendingRestore({ kind: "user", id: uid, page: Math.max(1, (upg as number) || 1) });
      }
    } catch {}
  }, [tab, aiMode]);

  useEffect(() => {
    if (aiMode || !pendingRestore) return;
    if (pendingRestore.page !== page) {
      setQuery({ page: pendingRestore.page, tab, oldestFirst: oldestFirst ? "1" : undefined });
      return;
    }
    if (listLoading) return;
    const targetId =
      pendingRestore.kind === "post" ? `post-${pendingRestore.id}` : `user-${pendingRestore.id}`;
    const el = document.getElementById(targetId);
    if (el) {
      const absoluteTop = window.scrollY + el.getBoundingClientRect().top;
      const desiredTop = Math.max(0, absoluteTop - window.innerHeight * 0.4);
      window.scrollTo({ top: desiredTop });
    }
    setPendingRestore(null);
    try {
      const st = (window.history.state as Record<string, unknown>) || {};
      const rest: Record<string, unknown> = { ...st };
      delete rest[RESTORE_POST_ID_KEY];
      delete rest[RESTORE_POST_PAGE_KEY];
      delete rest[RESTORE_USER_ID_KEY];
      delete rest[RESTORE_USER_PAGE_KEY];
      window.history.replaceState(rest, "");
    } catch {}
  }, [aiMode, pendingRestore, page, listLoading, oldestFirst, tab, setQuery]);

  async function handleLike(post: Post) {
    const postId = post.id;
    const prevLiked = !!post.isLikedByFocusUser;
    const prevCountLikes = Number(post.countLikes ?? 0);
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              isLikedByFocusUser: !prevLiked,
              countLikes: Number(p.countLikes ?? 0) + (prevLiked ? -1 : 1),
            }
          : p,
      ),
    );
    try {
      if (prevLiked) {
        await removeLike(postId);
      } else {
        await addLike(postId);
      }
    } catch {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                allowLikes: false,
                countLikes: prevCountLikes,
                isLikedByFocusUser: prevLiked,
              }
            : p,
        ),
      );
    }
  }

  async function handleReplySubmit(e: React.FormEvent) {
    e.preventDefault();
    setReplySubmitting(true);
    setReplyError(null);
    try {
      const { content, tags, attrs } = parseBodyAndTags(replyBody);
      if (!content.trim()) {
        throw new Error("Content is required.");
      }
      if (!isAdmin && content.length > Config.CONTENT_LENGTH_LIMIT) {
        throw new Error(`Content is too long (max ${Config.CONTENT_LENGTH_LIMIT} chars).`);
      }
      if (!isAdmin && tags.length > Config.TAGS_NUMBER_LIMIT) {
        throw new Error(`You can specify up to ${Config.TAGS_NUMBER_LIMIT} tags.`);
      }
      for (const tag of tags) {
        if (tag.length > 50) throw new Error(`Tag "${tag}" is too long (max 50 chars).`);
      }
      const allowLikes = !(attrs && (attrs["noLikes"] === true || attrs["nolikes"] === true));
      const allowReplies = !(attrs && (attrs["noReplies"] === true || attrs["noreplies"] === true));
      const locale = typeof attrs.locale === "string" ? attrs.locale : null;
      const id =
        isAdmin && typeof attrs.date === "string"
          ? makePostIdFromDateString(attrs.date)
          : undefined;
      if (isAdmin && typeof attrs.date === "string" && !id) {
        throw new Error("Invalid date.");
      }
      await createPost({ id, content, tags, replyTo, allowLikes, allowReplies, locale });
      setReplyBody("");
      setReplyTo(null);
      setTimeout(() => {
        listPosts({
          ownedBy: user?.id,
          offset: (page - 1) * Config.POSTS_PAGE_SIZE,
          limit: Config.POSTS_PAGE_SIZE + 1,
          order: oldestFirst ? "asc" : "desc",
          focusUserId: userId,
          replyTo: tab === "posts" ? null : tab === "replies" ? "*" : undefined,
        }).then((data) => setPosts(data.slice(0, Config.POSTS_PAGE_SIZE)));
      }, 100);
    } catch (err: unknown) {
      if (err instanceof Error) setReplyError(err.message || "Failed to reply.");
      else setReplyError(String(err) || "Failed to reply.");
    } finally {
      setReplySubmitting(false);
    }
  }

  function clearReplyError() {
    if (replyError) setReplyError(null);
  }

  if (!status) return null;
  if (loading) return <div className="text-center mt-10">Loading…</div>;
  if (error) return <div className="text-center mt-10 text-red-600">{error}</div>;
  if (!user) return <div className="text-center mt-10 text-gray-500">No user found.</div>;

  function tabLabel(tab: string) {
    switch (tab) {
      case "posts":
        return "Posts";
      case "replies":
        return "Replies";
      case "followers":
        return "Followers";
      case "followees":
        return "Followees";
      default:
        return tab;
    }
  }

  function handlePageChange(nextPage: number) {
    setQuery({ page: nextPage, tab, oldestFirst: oldestFirst ? "1" : undefined });
  }

  function handleTabChange(nextTab: (typeof TAB_VALUES)[number]) {
    const tabChanged = nextTab !== tab;
    if (tabChanged) pendingTabScrollRef.current = true;
    setQuery({ tab: nextTab, page: 1, oldestFirst: undefined }, { scroll: false });
    setReplyTo(null);
    setReplyBody("");
    setReplyError(null);
    if (!tabChanged) {
      requestAnimationFrame(() => requestAnimationFrame(scrollTabsToViewportTop10));
    }
  }

  function handleOldestFirstToggle(checked: boolean) {
    setQuery({ oldestFirst: checked ? "1" : undefined, tab, page: 1 }, { scroll: false });
    setReplyTo(null);
    setReplyBody("");
    setReplyError(null);
    requestAnimationFrame(() => requestAnimationFrame(scrollTabsToViewportTop10));
  }

  function handleAiPageChange(nextPage: number) {
    setAiQuery({
      aiTab,
      aiPage: nextPage,
      aiOldestFirst: aiOldestFirst ? "1" : undefined,
    });
    requestAnimationFrame(() => requestAnimationFrame(scrollTabsToViewportTop10));
  }

  function handleAiTabChange(nextTab: (typeof AI_TAB_VALUES)[number]) {
    const tabChanged = nextTab !== aiTab;
    if (tabChanged) pendingTabScrollRef.current = true;
    setAiQuery({ aiTab: nextTab, aiPage: 1, aiOldestFirst: undefined });
    if (!tabChanged) {
      requestAnimationFrame(() => requestAnimationFrame(scrollTabsToViewportTop10));
    }
  }

  function handleAiOldestFirstToggle(checked: boolean) {
    setAiQuery({ aiTab, aiPage: 1, aiOldestFirst: checked ? "1" : undefined });
    requestAnimationFrame(() => requestAnimationFrame(scrollTabsToViewportTop10));
  }

  function handleCloseAiImpressions() {
    const sp = new URLSearchParams(searchParams);
    sp.delete("view");
    sp.delete("aiTab");
    sp.delete("aiPage");
    sp.delete("aiOldestFirst");
    const q = sp.toString();
    router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
    requestAnimationFrame(() => requestAnimationFrame(scrollTabsToViewportTop10));
  }

  function handleViewAiImpressions(target: User | UserDetail) {
    const targetPath = `/users/${target.id}`;
    const sp = target.id === user?.id ? new URLSearchParams(searchParams) : new URLSearchParams();
    sp.set("view", "ai-impressions");
    sp.set("aiTab", "posts");
    sp.set("aiPage", "1");
    sp.delete("aiOldestFirst");
    router.push(`${targetPath}?${sp.toString()}`, { scroll: false });
  }

  return (
    <main className="max-w-3xl mx-auto mt-8 p-1 sm:p-4">
      <div ref={tabsPrecedingContentRef}>
        <UserCard
          user={user}
          truncated={false}
          focusUserId={userId}
          focusUserIsAdmin={!!isAdmin}
          onViewAiImpressions={handleViewAiImpressions}
          clickable={false}
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
            <UserForm
              user={user}
              isAdmin={isAdmin}
              isSelf={isSelf}
              onUpdated={(updatedUser) => {
                setUser(updatedUser ?? null);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        )}
      </div>

      <div ref={tabsRef} className="flex gap-1 mt-6 mb-2 items-center">
        {aiMode ? (
          <>
            {AI_TAB_VALUES.map((t) => (
              <button
                key={t}
                className={`px-3 max-md:px-1 py-1 rounded-t min-w-0 sm:min-w-[110px] text-sm font-normal cursor-pointer
                  ${aiTab === t ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
                onClick={() => handleAiTabChange(t)}
              >
                {t === "posts" ? "Posts" : t === "users" ? "Users" : "Interest"}
              </button>
            ))}
            {aiTab !== "interest" && (
              <label className="flex items-center gap-1 text-sm text-gray-700 cursor-pointer ml-4 max-md:ml-1">
                <input
                  type="checkbox"
                  checked={aiOldestFirst}
                  onChange={(e) => handleAiOldestFirstToggle(e.target.checked)}
                  className="cursor-pointer"
                />
                <span className="hidden md:inline">Oldest first</span>
                <span className="md:hidden scale-x-80 -ml-1" aria-hidden>
                  Oldest
                </span>
              </label>
            )}
            <button
              type="button"
              className="ml-auto px-2 py-1 text-lg leading-none text-gray-500 hover:text-gray-800"
              onClick={handleCloseAiImpressions}
              aria-label="Close AI impressions"
              title="Close"
            >
              ×
            </button>
          </>
        ) : (
          <>
            {TAB_VALUES.map((t) => (
              <button
                key={t}
                className={`px-3 max-md:px-1 py-1 rounded-t min-w-0 sm:min-w-[110px] text-sm font-normal cursor-pointer
                  ${tab === t ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
                onClick={() => handleTabChange(t)}
              >
                {tabLabel(t)}
              </button>
            ))}
            <label className="flex items-center gap-1 text-sm text-gray-700 cursor-pointer ml-4 max-md:ml-1">
              <input
                type="checkbox"
                checked={oldestFirst}
                onChange={(e) => handleOldestFirstToggle(e.target.checked)}
                className="cursor-pointer"
              />
              <span className="hidden md:inline">Oldest first</span>
              <span className="md:hidden scale-x-80 -ml-1" aria-hidden>
                Oldest
              </span>
            </label>
          </>
        )}
      </div>

      <div>
        {listLoading && <div className="text-gray-500">Loading…</div>}
        {listError && <div className="text-red-600">{listError}</div>}
        {!listLoading && !listError && (
          <>
            {aiMode && aiTab === "posts" && (
              <ul className="space-y-3">
                {aiPostImpressions.length === 0 && (
                  <li className="text-gray-400 text-center">No post impressions found.</li>
                )}
                {aiPostImpressions.map((item) => (
                  <li key={`${item.peerId}:${item.postId}`}>
                    <div className="rounded border bg-white p-3 shadow-sm">
                      <div className="flex items-start gap-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <a
                            href={`/users/${item.peerId}`}
                            className="font-semibold text-black hover:underline"
                          >
                            {item.peerNickname || item.peerId}
                          </a>
                        </div>
                        <span className="shrink-0 text-xs text-gray-400">
                          {formatDateTime(new Date(item.updatedAt))}
                        </span>
                      </div>
                      {item.postSnippet !== null && item.postSnippet !== undefined ? (
                        <a
                          href={`/posts/${item.postId}`}
                          className="mt-2 block rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          {item.postSnippet}
                        </a>
                      ) : (
                        <div className="mt-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-400">
                          deleted
                        </div>
                      )}
                      <ImpressionPayloadView payload={item.payload} kind="posts" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {aiMode && aiTab === "users" && (
              <ul className="space-y-3">
                {aiPeerImpressions.length === 0 && (
                  <li className="text-gray-400 text-center">No user impressions found.</li>
                )}
                {aiPeerImpressions.map((item) => (
                  <li key={item.peerId}>
                    <div className="rounded border bg-white p-3 shadow-sm">
                      <div className="flex items-start gap-2 text-sm">
                        <a
                          href={`/users/${item.peerId}`}
                          className="min-w-0 flex-1 font-semibold text-black hover:underline"
                        >
                          {item.peerNickname || item.peerId}
                        </a>
                        <span className="shrink-0 text-xs text-gray-400">
                          {formatDateTime(new Date(item.updatedAt))}
                        </span>
                      </div>
                      <ImpressionPayloadView payload={item.payload} kind="users" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {aiMode && aiTab === "interest" && (
              <div>
                {!aiInterest ? (
                  <div className="text-gray-400 text-center">No interest found.</div>
                ) : (
                  <div className="rounded border bg-white p-3 shadow-sm">
                    <div className="flex justify-end text-xs text-gray-400">
                      {formatDateTime(new Date(aiInterest.updatedAt))}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                      {aiInterest.interest}
                    </div>
                    {aiInterest.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                        {aiInterest.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-gray-100 px-2 py-0.5 text-blue-700"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {!aiMode && (tab === "posts" || tab === "replies") && (
              <ul className="space-y-4">
                {posts.length === 0 && (
                  <li className="text-gray-400 text-center">
                    No {tab === "posts" ? "posts" : "replies"} found.
                  </li>
                )}
                {posts.map((post, idx) => (
                  <li
                    key={post.id}
                    id={`post-${post.id}`}
                    onMouseDown={() => {
                      try {
                        const st = (window.history.state as Record<string, unknown>) || {};
                        window.history.replaceState(
                          { ...st, [RESTORE_POST_ID_KEY]: post.id, [RESTORE_POST_PAGE_KEY]: page },
                          "",
                        );
                      } catch {}
                    }}
                  >
                    <PostCard
                      post={post}
                      avatarVersion={post.ownedBy === userId ? (updatedAt ?? undefined) : undefined}
                      onLike={handleLike}
                      onReply={() => {
                        setReplyTo(post.id);
                        setReplyBody("");
                        setReplyError(null);
                      }}
                      focusUserId={userId}
                      focusUserIsAdmin={!!isAdmin}
                      idPrefix={`p${idx + 1}-h`}
                    />
                    {replyTo === post.id && (
                      <PostForm
                        body={replyBody}
                        setBody={setReplyBody}
                        onSubmit={handleReplySubmit}
                        submitting={replySubmitting}
                        error={replyError}
                        onErrorClear={clearReplyError}
                        buttonLabel="Reply"
                        placeholder="Write your reply. Use #tag lines for tags."
                        className="mt-8 flex flex-col"
                        onCancel={() => {
                          setReplyTo(null);
                          setReplyError(null);
                        }}
                        contentLengthLimit={isAdmin ? undefined : Config.CONTENT_LENGTH_LIMIT}
                        autoFocus
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!aiMode && tab === "followers" && (
              <ul className="space-y-4">
                {followers.length === 0 && (
                  <li className="text-gray-400 text-center">No followers found.</li>
                )}
                {followers.map((u, idx) => (
                  <li
                    key={u.id}
                    id={`user-${u.id}`}
                    onMouseDown={() => {
                      try {
                        const st = (window.history.state as Record<string, unknown>) || {};
                        window.history.replaceState(
                          { ...st, [RESTORE_USER_ID_KEY]: u.id, [RESTORE_USER_PAGE_KEY]: page },
                          "",
                        );
                      } catch {}
                    }}
                  >
                    <UserCard
                      user={u}
                      focusUserId={userId}
                      focusUserIsAdmin={!!isAdmin}
                      onViewAiImpressions={handleViewAiImpressions}
                      onClick={() => router.push(`/users/${u.id}`)}
                      idPrefix={`f${idx + 1}-h`}
                    />
                  </li>
                ))}
              </ul>
            )}
            {!aiMode && tab === "followees" && (
              <ul className="space-y-4">
                {followees.length === 0 && (
                  <li className="text-gray-400 text-center">No followees found.</li>
                )}
                {followees.map((u, idx) => (
                  <li
                    key={u.id}
                    id={`user-${u.id}`}
                    onMouseDown={() => {
                      try {
                        const st = (window.history.state as Record<string, unknown>) || {};
                        window.history.replaceState(
                          { ...st, [RESTORE_USER_ID_KEY]: u.id, [RESTORE_USER_PAGE_KEY]: page },
                          "",
                        );
                      } catch {}
                    }}
                  >
                    <UserCard
                      user={u}
                      focusUserId={userId}
                      focusUserIsAdmin={!!isAdmin}
                      onViewAiImpressions={handleViewAiImpressions}
                      onClick={() => router.push(`/users/${u.id}`)}
                      idPrefix={`f${idx + 1}-h`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {!listLoading && !listError && (!aiMode || aiTab !== "interest") && (
          <div className="mt-6 flex justify-center gap-4">
            <button
              className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() =>
                aiMode
                  ? handleAiPageChange(Math.max(1, aiPage - 1))
                  : handlePageChange(Math.max(1, page - 1))
              }
              disabled={(aiMode ? aiPage : page) === 1}
            >
              Prev
            </button>
            <span className="text-gray-800">Page {aiMode ? aiPage : page}</span>
            <button
              className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() =>
                aiMode
                  ? handleAiPageChange(hasNext ? aiPage + 1 : aiPage)
                  : handlePageChange(hasNext ? page + 1 : page)
              }
              disabled={!hasNext}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
