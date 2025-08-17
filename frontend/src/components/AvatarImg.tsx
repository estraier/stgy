"use client";

import { Config } from "@/config";
import React, { useMemo, useState } from "react";
import Image from "next/image";
import Identicon from "@/components/Identicon";

type Props = {
  userId: string;
  nickname: string;
  hasAvatar: boolean;
  size: number;
  useThumb: boolean;
  version?: string | number | null;
  avatarPath?: string | null;
  className?: string;
};

export default function AvatarImg({
  userId,
  nickname,
  hasAvatar,
  size,
  useThumb,
  version,
  avatarPath,
  className = "",
}: Props) {
  const base = Config.STORAGE_S3_PUBLIC_BASE_URL;
  const [error, setError] = useState(false);

  const suffix =
    version != null && version !== "" ? `?v=${encodeURIComponent(String(version))}` : "";

  const src = useMemo(() => {
    if (!hasAvatar) return "";
    if (useThumb) {
      return `${base}/${Config.MEDIA_BUCKET_PROFILES}/${encodeURIComponent(
        userId,
      )}/thumbs/avatar_icon.webp${suffix}`;
    }
    return avatarPath ? `${base}/${avatarPath}${suffix}` : "";
  }, [base, hasAvatar, useThumb, userId, avatarPath, suffix]);

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
    <Image
      src={src}
      width={size}
      height={size}
      alt={`${nickname}'s avatar`}
      className={`rounded-lg border border-gray-300 object-cover ${className || ""}`}
      unoptimized
      priority
      onError={() => setError(true)}
    />
  );
}
