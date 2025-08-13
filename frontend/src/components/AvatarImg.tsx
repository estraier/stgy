"use client";

import React, { useMemo, useState } from "react";
import Identicon from "@/components/Identicon";

type Props = {
  userId: string;
  nickname: string;
  hasAvatar: boolean;
  size: number;
  useThumb: boolean;
  avatarPath?: string | null; // e.g. "fakebook-profiles/<userId>/avatar.webp"
  className?: string;
};

export default function AvatarImg({
  userId,
  nickname,
  hasAvatar,
  size,
  useThumb,
  avatarPath,
  className = "",
}: Props) {
  const base = process.env.NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL || "http://localhost:9000";
  const [error, setError] = useState(false);

  const src = useMemo(() => {
    if (!hasAvatar) return "";
    if (useThumb) {
      return `${base}/fakebook-profiles/${encodeURIComponent(userId)}/thumbs/avatar_icon.webp`;
    }
    return avatarPath ? `${base}/${avatarPath}` : "";
  }, [base, hasAvatar, useThumb, userId, avatarPath]);

  if (!hasAvatar || error || !src) {
    return (
      <Identicon
        value={`${userId}:${nickname}`}
        size={size}
        className={`rounded-lg border border-gray-500 bg-gray-100 opacity-90 ${className || ""}`}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={size}
      height={size}
      alt={`${nickname}'s avatar`}
      className={`rounded-lg border border-gray-300 object-cover ${className || ""}`}
      onError={() => setError(true)}
    />
  );
}
