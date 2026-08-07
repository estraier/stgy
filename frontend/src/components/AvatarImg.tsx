"use client";

import { Config } from "@/config";
import React, { useState } from "react";
import Image from "next/image";
import Identicon from "@/components/Identicon";
import { NO_IMAGE_URL } from "@/utils/imageFallback";

type Props = {
  userId: string;
  nickname: string;
  hasAvatar: boolean;
  size: number;
  version?: string | number | null;
  className?: string;
};

export default function AvatarImg({
  userId,
  nickname,
  hasAvatar,
  size,
  version,
  className = "",
}: Props) {
  const [error, setError] = useState(false);

  const suffix =
    version != null && version !== "" ? `?v=${encodeURIComponent(String(version))}` : "";
  const prefix = Config.STORAGE_S3_PUBLIC_URL_PREFIX.replace(
    "{bucket}",
    Config.MEDIA_BUCKET_PROFILES,
  );
  const src = hasAvatar
    ? `${prefix}${encodeURIComponent(userId)}/thumbs/avatar_icon.webp${suffix}`
    : "";

  if (!hasAvatar || !src) {
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
      src={error ? NO_IMAGE_URL : src}
      width={size}
      height={size}
      alt={`${nickname}'s avatar`}
      className={`rounded-lg border border-gray-300 object-cover ${className || ""}`}
      unoptimized
      priority
      onError={() => {
        if (!error) setError(true);
      }}
    />
  );
}
