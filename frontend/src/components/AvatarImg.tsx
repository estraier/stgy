"use client";

import React, { useMemo, useState } from "react";
import Identicon from "@/components/Identicon";
import { getProfileUrl } from "@/api/media";

type Props = {
  userId: string;
  nickname: string;
  hasAvatar: boolean;
  size: number;
  useThumb: boolean;
  avatarPath?: string | null;
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
    if (avatarPath && avatarPath.trim() !== "") {
      return `${base}/${avatarPath}`;
    }
    return getProfileUrl(userId, "avatar");
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
    <img
      src={src}
      width={size}
      height={size}
      alt={`${nickname}'s avatar`}
      className={`rounded-lg border border-gray-300 object-cover ${className || ""}`}
      onError={() => setError(true)}
      loading="lazy"
    />
  );
}
