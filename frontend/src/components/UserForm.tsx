"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { UserDetail } from "@/api/models";
import { updateUser, getUser, deleteUser } from "@/api/users";
import { listAIModels } from "@/api/aiModels";
import {
  presignProfileUpload,
  finalizeProfile,
  getProfileUrl,
  deleteProfile,
  fetchProfileBinary,
} from "@/api/media";
import Link from "next/link";
import { Config } from "@/config";
import AvatarCropDialog from "@/components/AvatarCropDialog";
import { timeZonesNames } from "@vvo/tzdb";

type UserFormProps = {
  user: UserDetail;
  isAdmin: boolean;
  isSelf: boolean;
  onUpdated?: (user?: UserDetail) => void | Promise<void>;
  onCancel: () => void;
};

const LOCALE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "en-US", label: "English (United States)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "zh-CN", label: "Chinese (Simplified, China)" },
  { value: "zh-TW", label: "Chinese (Traditional, Taiwan)" },
  { value: "zh-HK", label: "Chinese (Traditional, Hong Kong)" },
  { value: "es-ES", label: "Spanish (Spain)" },
  { value: "es-MX", label: "Spanish (Mexico)" },
  { value: "hi-IN", label: "Hindi (India)" },
  { value: "ar-SA", label: "Arabic (Saudi Arabia)" },
  { value: "fr-FR", label: "French (France)" },
  { value: "bn-BD", label: "Bengali (Bangladesh)" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "pt-PT", label: "Portuguese (Portugal)" },
  { value: "ru-RU", label: "Russian (Russia)" },
  { value: "ur-PK", label: "Urdu (Pakistan)" },
  { value: "id-ID", label: "Indonesian (Indonesia)" },
  { value: "de-DE", label: "German (Germany)" },
  { value: "ja-JP", label: "Japanese (Japan)" },
  { value: "sw-KE", label: "Swahili (Kenya)" },
  { value: "tr-TR", label: "Turkish (Türkiye)" },
  { value: "it-IT", label: "Italian (Italy)" },
  { value: "ko-KR", label: "Korean (Korea)" },
  { value: "vi-VN", label: "Vietnamese (Vietnam)" },
  { value: "fa-IR", label: "Persian (Iran)" },
  { value: "ta-IN", label: "Tamil (India)" },
  { value: "pl-PL", label: "Polish (Poland)" },
  { value: "uk-UA", label: "Ukrainian (Ukraine)" },
  { value: "nl-NL", label: "Dutch (Netherlands)" },
  { value: "th-TH", label: "Thai (Thailand)" },
  { value: "fil-PH", label: "Filipino (Philippines)" },
  { value: "ms-MY", label: "Malay (Malaysia)" },
  { value: "he-IL", label: "Hebrew (Israel)" },
  { value: "el-GR", label: "Greek (Greece)" },
  { value: "ro-RO", label: "Romanian (Romania)" },
  { value: "sv-SE", label: "Swedish (Sweden)" },
  { value: "hu-HU", label: "Hungarian (Hungary)" },
  { value: "cs-CZ", label: "Czech (Czechia)" },
  { value: "sk-SK", label: "Slovak (Slovakia)" },
  { value: "bg-BG", label: "Bulgarian (Bulgaria)" },
  { value: "sr-RS", label: "Serbian (Serbia)" },
  { value: "hr-HR", label: "Croatian (Croatia)" },
  { value: "da-DK", label: "Danish (Denmark)" },
  { value: "fi-FI", label: "Finnish (Finland)" },
  { value: "nb-NO", label: "Norwegian Bokmål (Norway)" },
  { value: "et-EE", label: "Estonian (Estonia)" },
  { value: "lv-LV", label: "Latvian (Latvia)" },
  { value: "lt-LT", label: "Lithuanian (Lithuania)" },
  { value: "mr-IN", label: "Marathi (India)" },
  { value: "te-IN", label: "Telugu (India)" },
  { value: "pa-IN", label: "Punjabi (India)" },
];

export default function UserForm({ user, isAdmin, isSelf, onUpdated, onCancel }: UserFormProps) {
  const [email, setEmail] = useState(user.email ?? "");
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [introduction, setIntroduction] = useState(user.introduction ?? "");
  const [aiPersonality, setAIPersonality] = useState(user.aiPersonality ?? "");
  const [aiModel, setAIModel] = useState(user.aiModel ?? "");
  const [admin, setIsAdmin] = useState(user.isAdmin ?? false);
  const [blockStrangers, setBlockStrangers] = useState(user.blockStrangers ?? false);
  const [locale, setLocale] = useState(user.locale || "en-US");
  const [timezone, setTimezone] = useState(user.timezone || "UTC");

  const [aiModels, setAIModels] = useState<{ label: string; service: string; name: string }[]>([]);
  const [aiModelsLoading, setAIModelsLoading] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  const [avatarUrl, setAvatarUrl] = useState(user.avatar ? getProfileUrl(user.id, "avatar") : "");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [cropFile, setCropFile] = useState<File | null>(null);
  const [showCrop, setShowCrop] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAIModelsLoading(true);
    listAIModels()
      .then(setAIModels)
      .catch(() => setAIModels([]))
      .finally(() => setAIModelsLoading(false));
  }, []);

  const localeOptions = useMemo(() => {
    const has = new Set(LOCALE_OPTIONS.map((o) => o.value));
    const arr = [...LOCALE_OPTIONS];
    if (user.locale && !has.has(user.locale)) {
      arr.unshift({ value: user.locale, label: `${user.locale}` });
    }
    return arr;
  }, [user.locale]);

  const timezoneOptions = useMemo(() => {
    const names = timeZonesNames.slice();
    if (user.timezone && !names.includes(user.timezone)) {
      names.unshift(user.timezone);
    }
    return names;
  }, [user.timezone]);

  function isValidEmail(s: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  function handleClearFormError() {
    setFormError(null);
  }

  async function handleDeleteUser(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await deleteUser(user.id);
      setDeleteSuccess(true);
      if (onUpdated) await onUpdated(undefined);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to delete user.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (isAdmin && !isValidEmail(email)) {
      setFormError("Invalid email address.");
      return;
    }
    if (!nickname.trim()) {
      setFormError("Nickname is required.");
      return;
    }
    if (aiModel && !aiPersonality.trim()) {
      setFormError("AI Personality is required when an AI Model is set.");
      return;
    }
    if (introduction.trim() === "") {
      setFormError("Introduction is required.");
      return;
    }
    if (!isAdmin && introduction.length > Config.INTRODUCTION_LENGTH_LIMIT) {
      setFormError(`Introduction is too long (max ${Config.INTRODUCTION_LENGTH_LIMIT} chars).`);
      return;
    }
    if (aiModel && !isAdmin && aiPersonality.length > Config.AI_PERSONALITY_LENGTH_LIMIT) {
      setFormError(`AI Personality is too long (max ${Config.AI_PERSONALITY_LENGTH_LIMIT} chars).`);
      return;
    }
    if (!timezone) {
      setFormError("Timezone is required.");
      return;
    }
    if (!locale) {
      setFormError("Locale is required.");
      return;
    }

    setSubmitting(true);
    try {
      const input: Record<string, unknown> = {
        nickname,
        introduction,
        blockStrangers,
      };
      if (isAdmin) {
        input.email = email;
        input.isAdmin = admin;
        input.aiModel = aiModel || null;
      }
      if (aiModel) {
        input.aiPersonality = aiPersonality;
      }
      if (locale !== user.locale) input.locale = locale;
      if (timezone !== user.timezone) input.timezone = timezone;

      await updateUser(user.id, input);
      const updatedUser = await getUser(user.id, user.id);
      if (onUpdated) {
        await onUpdated(updatedUser);
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to update user.");
    } finally {
      setSubmitting(false);
    }
  }

  async function waitForAvatarReady(maxMs = 5000) {
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < maxMs) {
      try {
        const blob = await fetchProfileBinary(user.id, "avatar");
        if (blob && blob.size > 0) return;
      } catch {}
      attempt += 1;
      const delay = Math.min(1000, 150 * Math.pow(1.5, attempt));
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  function handleChooseFile() {
    setAvatarError(null);
    fileInputRef.current?.click();
  }

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    const file = e.target.files[0];
    if (file.type === "image/svg+xml") {
      setAvatarError("SVG is not supported for avatars.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setCropFile(file);
    setShowCrop(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadCropped(blob: Blob, suggestedName: string) {
    try {
      setAvatarError(null);
      setUploadingAvatar(true);
      const fileName = suggestedName || "avatar.webp";
      const { url, fields, objectKey } = await presignProfileUpload(
        user.id,
        "avatar",
        fileName,
        blob.size,
      );
      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v as string));
      formData.append("file", new File([blob], fileName, { type: blob.type || "image/webp" }));
      const resp = await fetch(url, { method: "POST", body: formData });
      if (!resp.ok) throw new Error("Upload failed");
      await finalizeProfile(user.id, "avatar", objectKey);
      await waitForAvatarReady(5000);
      setAvatarUrl(`${getProfileUrl(user.id, "avatar")}?v=${Date.now()}`);
      setAvatarError(null);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Failed to upload avatar.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleRemoveAvatar() {
    try {
      setAvatarError(null);
      setUploadingAvatar(true);
      await deleteProfile(user.id, "avatar");
      setAvatarUrl("");
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Failed to remove avatar.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  const canDelete = isAdmin && !isSelf && email.trim() === "";

  return (
    <>
      <form
        className="flex flex-col gap-2 border border-gray-300 rounded p-4 bg-white"
        onSubmit={canDelete ? handleDeleteUser : handleSubmit}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <label className="font-bold text-sm">Avatar Image</label>
          {avatarUrl && (
            <Image
              src={avatarUrl}
              alt="avatar"
              width={384}
              height={384}
              className="rounded object-cover mb-2 border border-gray-400"
              unoptimized
              priority
            />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleChooseFile}
              disabled={uploadingAvatar}
              className={`px-3 py-1 rounded border transition ${
                uploadingAvatar
                  ? "bg-gray-200 text-gray-400 border-gray-300 cursor-not-allowed"
                  : "bg-gray-300 text-gray-900 border-gray-700 hover:bg-gray-400"
              }`}
            >
              {uploadingAvatar ? "Uploading…" : "Choose image file"}
            </button>
            {avatarUrl && (
              <button
                type="button"
                onClick={handleRemoveAvatar}
                disabled={uploadingAvatar}
                className="px-3 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition disabled:text-gray-400 disabled:border-gray-300"
              >
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            onChange={handleAvatarChange}
            disabled={uploadingAvatar}
            className="sr-only"
          />
          {uploadingAvatar && <span className="text-xs text-gray-500">Uploading…</span>}
          {avatarError && (
            <div className="mt-1 text-sm text-red-600" role="alert" aria-live="polite">
              {avatarError}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex flex-row items-center justify-between">
            <label className="font-bold text-sm">Email</label>
            <span className="text-xs text-gray-400 ml-2 mr-1">
              (a reachable address is required)
            </span>
          </div>
          {isAdmin ? (
            <input
              className="border border-gray-400 rounded px-2 py-1 bg-gray-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!isAdmin}
              required={isAdmin && !isSelf && !canDelete}
              onFocus={handleClearFormError}
            />
          ) : (
            <div className="flex flex-row items-center gap-2">
              <span className="text-gray-700">{user.email}</span>
              {isSelf && (
                <Link
                  href="/auth-settings"
                  className="text-blue-600 hover:underline text-xs opacity-70 hover:opacity-100"
                  style={{ marginLeft: "8px" }}
                >
                  (change)
                </Link>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex flex-row items-center justify-between">
            <label className="font-bold text-sm">Nickname</label>
            <span className="text-xs text-gray-400 ml-2 mr-1">
              (non-ASCII characters can also be used)
            </span>
          </div>
          <input
            className="border border-gray-400 rounded px-2 py-1 bg-gray-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            required
            onFocus={handleClearFormError}
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex flex-row items-center justify-between">
            <label className="font-bold text-sm">Introduction</label>
            <span className="text-xs text-gray-400 ml-2 mr-1">
              (Markdown notations can be used)
            </span>
          </div>
          <textarea
            className="border border-gray-400 rounded px-2 py-1 min-h-[20ex] bg-gray-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed break-all"
            value={introduction}
            onChange={(e) => setIntroduction(e.target.value)}
            maxLength={isAdmin ? undefined : Config.INTRODUCTION_LENGTH_LIMIT}
            required
            onFocus={handleClearFormError}
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex flex-row items-center justify-between">
            <label className="font-bold text-sm">Locale</label>
            <span className="text-xs text-gray-400 ml-2 mr-1">
              (profile language and default post language)
            </span>
          </div>
          <select
            className="border border-gray-400 rounded px-2 py-1 bg-gray-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            onFocus={handleClearFormError}
          >
            {localeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} [{opt.value}]
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex flex-row items-center justify-between">
            <label className="font-bold text-sm">Timezone</label>
            <span className="text-xs text-gray-400 ml-2 mr-1">(used in notifications etc)</span>
          </div>
          <select
            className="border border-gray-400 rounded px-2 py-1 bg-gray-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            onFocus={handleClearFormError}
          >
            {timezoneOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex flex-row items-center justify-between">
            <label className="font-bold text-sm">AI Model</label>
            <span className="text-xs text-gray-400 ml-2 mr-1">
              {isAdmin ? "(used for autonomous behaviors)" : "(only admin can change)"}
            </span>
          </div>
          {aiModelsLoading ? (
            <div className="text-gray-400 text-xs">Loading models…</div>
          ) : (
            <select
              className="border border-gray-400 rounded px-2 py-1 bg-gray-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              value={aiModel}
              onChange={(e) => setAIModel(e.target.value)}
              disabled={!isAdmin}
              onFocus={handleClearFormError}
            >
              <option value="">(None)</option>
              {aiModels.map((m) => (
                <option key={m.label} value={m.label}>
                  {m.label}
                  {m.service ? ` - ${m.service}` : ""}
                  {m.name ? ` - ${m.name}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {aiModel && (
          <div className="flex flex-col gap-1">
            <label className="font-bold text-sm">AI Personality</label>
            <textarea
              className="border border-gray-400 rounded px-2 py-1 min-h-[64px] bg-gray-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed break-all"
              value={aiPersonality}
              onChange={(e) => setAIPersonality(e.target.value)}
              required
              onFocus={handleClearFormError}
              placeholder="Describe AI personality"
              maxLength={isAdmin ? undefined : Config.AI_PERSONALITY_LENGTH_LIMIT}
            />
          </div>
        )}

        {(isSelf || isAdmin) && (
          <div className="flex flex-row items-center gap-2">
            <input
              type="checkbox"
              id="blockStrangers"
              checked={blockStrangers}
              onChange={(e) => setBlockStrangers(e.target.checked)}
              className="mr-2"
              disabled={submitting}
            />
            <label htmlFor="blockStrangers" className="font-semibold text-sm">
              Block strangers
            </label>
            <span className="text-xs text-gray-400 ml-1">(only allow followees to like/reply)</span>
          </div>
        )}

        {isAdmin && (
          <div className="flex flex-row items-center gap-2">
            <input
              type="checkbox"
              id="isAdmin"
              checked={admin}
              onChange={(e) => setIsAdmin(e.target.checked)}
              className="mr-2 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              disabled={isSelf}
            />
            <label htmlFor="isAdmin" className="font-semibold text-sm">
              Admin
            </label>
            {isSelf && (
              <span className="text-xs text-gray-400 ml-1">
                (You can&apos;t change your own admin status)
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mt-2">
          <span className="flex-1 text-red-600 text-sm" role="alert" aria-live="polite">
            {formError && formError}
          </span>
          <button
            type="button"
            className="bg-gray-200 text-gray-700 px-4 py-1 rounded border border-gray-300 cursor-pointer hover:bg-gray-300 transition"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          {canDelete ? (
            <button
              type="submit"
              className="bg-red-500 text-white hover:bg-red-600 px-4 py-1 rounded cursor-pointer ml-auto"
              disabled={submitting || deleteSuccess}
            >
              {deleteSuccess ? "Deleted" : "Delete"}
            </button>
          ) : (
            <button
              type="submit"
              className="bg-blue-500 text-white hover:bg-blue-600 px-4 py-1 rounded cursor-pointer ml-auto"
              disabled={submitting}
            >
              {submitting ? "Saving..." : "Save"}
            </button>
          )}
        </div>
        {canDelete && (
          <div className="text-xs text-red-700 mt-2">
            This will <b>permanently delete</b> this user and all their data.
            <br />
            Are you sure?
          </div>
        )}
      </form>

      {showCrop && cropFile && (
        <AvatarCropDialog
          file={cropFile}
          onCancel={() => {
            setShowCrop(false);
            setCropFile(null);
          }}
          onCropped={async (blob, suggested) => {
            setShowCrop(false);
            setCropFile(null);
            await uploadCropped(blob, suggested);
          }}
          title="Crop avatar"
          buttonLabel="Apply"
        />
      )}
    </>
  );
}
