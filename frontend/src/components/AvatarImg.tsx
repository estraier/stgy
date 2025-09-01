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
  const [error, setError] = useState(false);

  const suffix =
    version != null && version !== "" ? `?v=${encodeURIComponent(String(version))}` : "";

  const src = useMemo(() => {
    if (!hasAvatar) return "";

    if (useThumb) {
      const prefix = Config.STORAGE_S3_PUBLIC_URL_PREFIX.replace(
        "{bucket}",
        Config.MEDIA_BUCKET_PROFILES,
      );
      return `${prefix}${encodeURIComponent(userId)}/thumbs/avatar_icon.webp${suffix}`;
    }

    if (avatarPath) {
      const p = avatarPath.replace(/^\/+/, "");
      const i = p.indexOf("/");
      if (i <= 0) return "";
      const bucket = p.slice(0, i);
      const key = p.slice(i + 1);
      const prefix = Config.STORAGE_S3_PUBLIC_URL_PREFIX.replace("{bucket}", bucket);
      return `${prefix}${key}${suffix}`;
    }

    return "";
  }, [hasAvatar, useThumb, userId, avatarPath, suffix]);

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
