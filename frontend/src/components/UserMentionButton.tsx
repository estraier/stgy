"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GeoAddress, GeoPlace } from "@/api/geo";
import { encodeGeo } from "@/api/geo";
import type { User } from "@/api/models";
import { listFriendsByNicknamePrefix } from "@/api/users";
import AvatarImg from "@/components/AvatarImg";
import { makeTextFromJsonSnippet } from "@/utils/article";
import { AtSign } from "lucide-react";
import { calculatePopoverPosition } from "@/utils/popover";

type UserMentionButtonProps = {
  onInsert: (markdown: string) => void;
  className?: string;
  title?: string;
};

export default function UserMentionButton({
  onInsert,
  className = "",
  title = "Mention user",
}: UserMentionButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [places, setPlaces] = useState<GeoPlace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });
  const anchorRectRef = useRef<DOMRect | null>(null);
  const geoMode = query.startsWith("%");

  const doFetch = useCallback(async (q: string, requestId: number) => {
    setLoading(true);
    setError(null);
    try {
      if (q.startsWith("%")) {
        const placeQuery = q.slice(1).trim();
        if (!placeQuery) {
          if (requestId === requestIdRef.current) {
            setUsers([]);
            setPlaces([]);
          }
          return;
        }
        const res = await encodeGeo(placeQuery, "ja");
        if (requestId === requestIdRef.current) {
          setUsers([]);
          setPlaces(res);
        }
      } else {
        const userQuery = q.trim();
        const res = await listFriendsByNicknamePrefix({
          limit: 20,
          ...(userQuery ? { nicknamePrefix: userQuery } : { omitOthers: true }),
        });
        if (requestId === requestIdRef.current) {
          setUsers(res);
          setPlaces([]);
        }
      }
    } catch (e) {
      if (requestId === requestIdRef.current) {
        setUsers([]);
        setPlaces([]);
        setError(e instanceof Error ? e.message : "Failed to search");
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    requestIdRef.current += 1;
    if (!open) return;
    const requestId = requestIdRef.current;
    const timer = window.setTimeout(() => {
      void doFetch(query, requestId);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, query, doFetch]);

  const updatePosition = useCallback(() => {
    const currentAnchor = containerRef.current?.getBoundingClientRect();
    if (currentAnchor && (currentAnchor.width > 0 || currentAnchor.height > 0)) {
      anchorRectRef.current = currentAnchor;
    }
    const anchor = anchorRectRef.current;
    if (!anchor) return;
    const dialogHeight = dialogRef.current?.getBoundingClientRect().height || 336;
    setPosition(
      calculatePopoverPosition(anchor, {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        popoverHeight: dialogHeight,
      }),
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    updatePosition();
    const raf = window.requestAnimationFrame(updatePosition);
    const observer =
      dialog && typeof ResizeObserver !== "undefined" ? new ResizeObserver(updatePosition) : null;
    if (dialog) observer?.observe(dialog);

    function onDocMouseDown(ev: MouseEvent) {
      const target = ev.target as Node;
      if (containerRef.current?.contains(target) || dialogRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const onPickUser = useCallback(
    (user: User) => {
      const label = escapeLabelForMarkdown(user.nickname || "");
      const url = `/users/${encodeURIComponent(user.id)}`;
      onInsert(`[@${label}](${url})`);
      setOpen(false);
    },
    [onInsert],
  );

  const onPickPlace = useCallback(
    (place: GeoPlace, address: GeoAddress) => {
      const label = escapeLabelForMarkdown(address.label);
      onInsert(`@[${label}](map://${place.longitude},${place.latitude},11)`);
      setOpen(false);
    },
    [onInsert],
  );

  const content = useMemo(() => {
    if (loading) {
      return <div className="py-4 text-center text-sm text-gray-500">Loading…</div>;
    }
    if (error) {
      return <div className="py-4 text-center text-sm text-red-600">{error}</div>;
    }
    if (geoMode) {
      if (!query.slice(1).trim() || !places.length) {
        return <div className="py-4 text-center text-sm text-gray-500">No places</div>;
      }
      return (
        <ul className="max-h-64 overflow-auto divide-y">
          {places.map((place, index) => {
            const address = getPreferredAddress(place, "ja");
            if (!address) return null;
            return (
              <li key={`${place.country}:${place.level}:${address.label}:${index}`}>
                <button
                  type="button"
                  className="w-full px-2 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                  onClick={() => onPickPlace(place, address)}
                  title={`Insert map ${address.label}`}
                >
                  <div className="text-sm text-gray-900 truncate">{address.label}</div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {place.longitude}, {place.latitude}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      );
    }
    if (!users.length) {
      return <div className="py-4 text-center text-sm text-gray-500">No users</div>;
    }
    return (
      <ul className="max-h-64 overflow-auto divide-y">
        {users.map((user) => {
          const intro = makeTextFromJsonSnippet(user.snippet);
          const hasAvatar = !!user.avatar;
          const avatarVersion = user.updatedAt ?? null;

          return (
            <li key={user.id}>
              <button
                type="button"
                className="w-full px-2 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                onClick={() => onPickUser(user)}
                title={`Insert mention @${user.nickname}`}
              >
                <div className="flex items-start gap-2">
                  <AvatarImg
                    userId={user.id}
                    nickname={user.nickname}
                    hasAvatar={hasAvatar}
                    size={32}
                    version={avatarVersion}
                    className="shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900 truncate">{user.nickname}</div>
                    <div className="text-[11px] text-gray-500 truncate">{intro || "—"}</div>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }, [error, geoMode, loading, onPickPlace, onPickUser, places, query, users]);

  return (
    <div ref={containerRef} className={"relative inline-block " + className}>
      <button
        type="button"
        className="inline-flex h-6 px-2 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none"
        onMouseDown={(event) => {
          event.preventDefault();
          anchorRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
          setOpen((value) => !value);
        }}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <AtSign size={16} aria-hidden className="opacity-80" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dialogRef}
            role="dialog"
            aria-label="Search users or places"
            className={
              "fixed z-[2000] overflow-hidden rounded border border-gray-200 " +
              "bg-white p-0 shadow-lg"
            }
            style={{
              top: position.top,
              left: position.left,
              right: "auto",
              bottom: "auto",
              width: position.width,
              margin: 0,
            }}
          >
            <div className="p-2 border-b bg-gray-50">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search users or %place…"
                className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            {content}
          </div>,
          document.body,
        )}
    </div>
  );
}

function getPreferredAddress(place: GeoPlace, locale: string): GeoAddress | undefined {
  return place.addresses.find((address) => address.locale === locale) ?? place.addresses[0];
}

function escapeLabelForMarkdown(label: string): string {
  return label.replace(/([\[\]])/g, "_");
}
