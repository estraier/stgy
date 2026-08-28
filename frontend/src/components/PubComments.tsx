"use client";

import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { getSessionInfo } from "@/api/auth";
import {
  approvePubComment,
  createPubComment,
  deletePubComment,
  editAuthorPubComment,
  getPubCommentFormState,
  listPubComments,
  type PubCommentFormState,
} from "@/api/pubComments";
import { createCaptchaChallenge, type CaptchaChallenge } from "@/api/captcha";
import type { PubComment } from "@/api/models";
import { convertForDirection, formatDateTime } from "@/utils/format";

const EMPTY_FORM_STATE: PubCommentFormState = {
  captchaRequired: true,
  nickname: "",
  canPostAsAuthor: false,
  asAuthor: false,
  canPost: true,
  limitReached: false,
};

type Props = {
  postId: string;
  ownerId: string;
  themeDir: "norm" | "vert";
};

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14.4" height="14.4" aria-hidden="true" focusable="false">
      <path
        d="M4 20h4.2L19 9.2a2.1 2.1 0 0 0 0-3L17.8 5a2.1 2.1 0 0 0-3 0L4 15.8V20Zm9.4-12.2 2.8 2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}


function BadgeCheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function ApproveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="m5 12 4 4L19 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12.24" height="12.24" aria-hidden="true" focusable="false">
      <path
        d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PubComments({ postId, ownerId, themeDir }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const ui = useCallback((text: string) => convertForDirection(text, themeDir), [themeDir]);
  const [comments, setComments] = useState<PubComment[]>([]);
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [hasPrevious, setHasPrevious] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ownerLoggedIn, setOwnerLoggedIn] = useState(false);
  const [adminLoggedIn, setAdminLoggedIn] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formState, setFormState] = useState<PubCommentFormState>(EMPTY_FORM_STATE);
  const [nickname, setNickname] = useState("");
  const [body, setBody] = useState("");
  const [asAuthor, setAsAuthor] = useState(false);
  const [challenge, setChallenge] = useState<CaptchaChallenge | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNickname, setEditNickname] = useState("");
  const [editBody, setEditBody] = useState("");

  const loadComments = useCallback(
    async (nextPage = page, nextOrder = order) => {
      setLoading(true);
      setError(null);
      try {
        const result = await listPubComments({ postId, page: nextPage, order: nextOrder });
        setComments(result.comments);
        setPage(result.page);
        setHasPrevious(result.hasPrevious);
        setHasNext(result.hasNext);
        setLimitReached(result.limitReached);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [order, page, postId],
  );

  useEffect(() => {
    void loadComments(1, "newest");
  }, [postId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (themeDir !== "vert") return;

    const section = sectionRef.current;
    const surface = surfaceRef.current;
    const main = section?.closest(".pub-main");
    const article = main?.querySelector<HTMLElement>(
      ".pub-article-with-share > .markdown-body, :scope > .markdown-body",
    );
    if (!section || !surface || !article) return;

    let frame = 0;

    const syncPanelGeometry = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Use the actual painted article frame as the vertical comment panel
        // height. This keeps all vertical publication themes aligned even
        // when borders, padding, fonts, or viewport limits differ.
        const articleHeight = article.getBoundingClientRect().height;
        if (articleHeight > 0) {
          surface.style.height = `${articleHeight}px`;
          surface.style.minHeight = `${articleHeight}px`;
          surface.style.maxHeight = `${articleHeight}px`;

          const style = getComputedStyle(surface);
          const contentHeight = Math.max(
            0,
            articleHeight
              - Number.parseFloat(style.paddingTop || "0")
              - Number.parseFloat(style.paddingBottom || "0")
              - Number.parseFloat(style.borderTopWidth || "0")
              - Number.parseFloat(style.borderBottomWidth || "0"),
          );
          surface.style.setProperty("--pub-comments-column-height", `${contentHeight}px`);
        }

        // Reset the physical width before measuring overflow so repeated
        // comment/form updates never accumulate stale extra width.
        surface.style.width = "max-content";

        frame = requestAnimationFrame(() => {
          const surfaceRect = surface.getBoundingClientRect();
          let minLeft = surfaceRect.left;
          let maxRight = surfaceRect.right;

          for (const element of surface.querySelectorAll<HTMLElement>("*")) {
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            minLeft = Math.min(minLeft, rect.left);
            maxRight = Math.max(maxRight, rect.right);
          }

          const requiredWidth = Math.ceil(maxRight - minLeft);
          if (requiredWidth > 0) surface.style.width = `${requiredWidth}px`;
        });
      });
    };

    syncPanelGeometry();

    const articleObserver = new ResizeObserver(syncPanelGeometry);
    articleObserver.observe(article);

    const mutationObserver = new MutationObserver(syncPanelGeometry);
    mutationObserver.observe(surface, { childList: true, subtree: true, characterData: true });

    window.addEventListener("resize", syncPanelGeometry);
    return () => {
      cancelAnimationFrame(frame);
      articleObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", syncPanelGeometry);
      surface.style.removeProperty("height");
      surface.style.removeProperty("min-height");
      surface.style.removeProperty("max-height");
      surface.style.removeProperty("width");
      surface.style.removeProperty("--pub-comments-column-height");
    };
  }, [themeDir]);

  useEffect(() => {
    let cancelled = false;
    getSessionInfo()
      .then((session) => {
        if (!cancelled) {
          setOwnerLoggedIn(session.userId === ownerId);
          setAdminLoggedIn(session.userIsAdmin);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOwnerLoggedIn(false);
          setAdminLoggedIn(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  const loadChallenge = useCallback(async () => {
    const next = await createCaptchaChallenge();
    setChallenge(next);
    setCaptchaAnswer("");
  }, []);

  const openForm = async () => {
    setError(null);
    setMessage(null);
    try {
      const state = await getPubCommentFormState(postId);
      setFormState(state);
      setNickname(state.nickname);
      setAsAuthor(state.asAuthor);
      if (!state.canPost || state.limitReached) {
        setLimitReached(true);
        setFormOpen(false);
        setChallenge(null);
        return;
      }
      setFormOpen(true);
      if (state.captchaRequired) await loadChallenge();
      else setChallenge(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createPubComment({
        postId,
        nickname,
        body,
        asAuthor,
        captchaId: formState.captchaRequired ? challenge?.challengeId : undefined,
        captchaAnswer: formState.captchaRequired ? captchaAnswer : undefined,
      });
      setBody("");
      setCaptchaAnswer("");
      setFormOpen(false);
      setChallenge(null);
      setMessage(
        result.comment.status === "pending"
          ? "Comment submitted for approval."
          : "Comment posted.",
      );
      setOrder("newest");
      await loadComments(1, "newest");
      requestAnimationFrame(() => {
        headingRef.current?.scrollIntoView({ block: "start", inline: "nearest" });
      });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setError(text);
      setCaptchaAnswer("");
      if (/captcha required/i.test(text)) {
        try {
          const state = await getPubCommentFormState(postId);
          setFormState(state);
          if (state.captchaRequired) await loadChallenge();
        } catch {}
      }
      if (/comment limit/i.test(text)) {
        setLimitReached(true);
        setFormOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const changeOrder = async (next: "newest" | "oldest") => {
    if (next === order) return;
    setOrder(next);
    await loadComments(1, next);
  };

  const remove = async (comment: PubComment) => {
    if (!window.confirm(ui("Delete this comment?"))) return;
    setError(null);
    try {
      await deletePubComment(comment.id);
      const nextPage = comments.length === 1 && page > 1 ? page - 1 : page;
      await loadComments(nextPage, order);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const approve = async (comment: PubComment) => {
    setError(null);
    try {
      const updated = await approvePubComment(comment.id);
      setComments((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const beginEdit = (comment: PubComment) => {
    setEditingId(comment.id);
    setEditNickname(comment.nickname);
    setEditBody(comment.body.replace(/\n$/, ""));
    setError(null);
  };

  const saveEdit = async (comment: PubComment) => {
    setError(null);
    try {
      const updated = await editAuthorPubComment(comment.id, {
        nickname: editNickname,
        body: editBody,
      });
      setComments((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section ref={sectionRef} className="pub-comments" id="comments" aria-label="Comments">
      <div ref={surfaceRef} className="pub-comments-surface">
      <div className="pub-comments-toolbar">
        <h2 ref={headingRef}>{ui("Comments")}</h2>
        <div className="pub-comments-controls">
          <label className="pub-comments-order" aria-label="Comment order">
            <input
              type="checkbox"
              checked={order === "oldest"}
              onChange={(event) =>
                void changeOrder(event.target.checked ? "oldest" : "newest")
              }
            />
            <span>{ui("Oldest")}</span>
          </label>
          <nav className="pub-comments-pager" aria-label="Comment pages">
            <button
              type="button"
              disabled={!hasPrevious || loading}
              onClick={() => void loadComments(page - 1, order)}
              aria-label="Previous page"
              title={ui("Previous page")}
            >
              ◁
            </button>
            <span>{ui(String(page))}</span>
            <button
              type="button"
              disabled={!hasNext || loading}
              onClick={() => void loadComments(page + 1, order)}
              aria-label="Next page"
              title={ui("Next page")}
            >
              ▷
            </button>
          </nav>
        </div>
      </div>

      {loading && comments.length === 0 ? (
        <div className="pub-comments-note">{ui("Loading…")}</div>
      ) : comments.length === 0 ? (
        <div className="pub-comments-note">{ui("No comments yet.")}</div>
      ) : (
        <div className="pub-comment-list">
          {comments.map((comment) => (
            <article
              className={`pub-comment${comment.status === "pending" ? " pub-comment-pending" : ""}`}
              key={comment.id}
            >
              {editingId === comment.id ? (
                <div className="pub-comment-edit-form rounded border border-gray-300 p-3">
                  <input
                    value={editNickname}
                    maxLength={30}
                    onChange={(event) => setEditNickname(event.target.value)}
                    aria-label="Nickname"
                    
                  />
                  <textarea
                    value={editBody}
                    maxLength={1000}
                    rows={6}
                    onChange={(event) => setEditBody(event.target.value)}
                    aria-label="Comment"
                    
                  />
                  <div className="pub-comment-actions">
                    <button
                      type="button"
                      className="rounded border border-gray-400 bg-gray-100 px-2 py-1 hover:bg-gray-200"
                      onClick={() => void saveEdit(comment)}
                    >
                      {ui("Save")}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-gray-400 bg-gray-100 px-2 py-1 hover:bg-gray-200"
                      onClick={() => setEditingId(null)}
                    >
                      {ui("Cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <header className="pub-comment-header">
                    <div className="pub-comment-nickname" title={comment.nickname}>
                      {ui(comment.nickname)}
                    </div>
                    <span className="pub-comment-author-slot">
                      {comment.isAuthor && (
                        <span className="pub-comment-author" title={ui("Author")} aria-label="Author">
                          <BadgeCheckIcon />
                        </span>
                      )}
                    </span>
                    <time dateTime={comment.createdAt}>
                      {ui(formatDateTime(new Date(comment.createdAt), undefined, true))}
                    </time>
                    {comment.status === "pending" && (
                      <span className="pub-comment-pending-label">{ui("Pending")}</span>
                    )}
                    {(ownerLoggedIn || adminLoggedIn) && (
                      <div className="pub-comment-actions">
                        {comment.status === "pending" && (
                          <button
                            type="button"
                            className="pub-comment-icon-button pub-comment-approve-button"
                            onClick={() => void approve(comment)}
                            aria-label="Approve comment"
                            title={ui("Approve")}
                          >
                            <ApproveIcon />
                          </button>
                        )}
                        {(adminLoggedIn || comment.isAuthor) && (
                          <button
                            type="button"
                            className="pub-comment-icon-button"
                            onClick={() => beginEdit(comment)}
                            aria-label="Edit comment"
                            title={ui("Edit")}
                          >
                            <PencilIcon />
                          </button>
                        )}
                        <button
                          type="button"
                          className="pub-comment-icon-button"
                          onClick={() => void remove(comment)}
                          aria-label="Delete comment"
                          title={ui("Delete")}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    )}
                  </header>
                  <pre className="pub-comment-body">{comment.body}</pre>
                </>
              )}
            </article>
          ))}
        </div>
      )}

      {message && <div className="pub-comments-message">{ui(message)}</div>}
      {error && <div className="pub-comments-error">{error}</div>}

      {!formOpen && !limitReached && (
        <button
          type="button"
          className="pub-comment-write rounded border border-gray-400 bg-gray-100 px-3 py-1.5 hover:bg-gray-200"
          onClick={() => void openForm()}
        >
          {ui("Write a comment")}
        </button>
      )}
      {limitReached && (
        <div className="pub-comments-note">{ui("No more comments can be added.")}</div>
      )}

      {formOpen && (
        <form
          className="pub-comment-form rounded border border-gray-300 p-4"
          onSubmit={(event) => void submit(event)}
        >
          <div className="pub-comment-form-nickname-row">
            <div className="pub-comment-nickname-field">
              <label className="pub-comment-form-nickname-label" htmlFor={`pub-comment-nickname-${postId}`}>
                {ui("Nickname")}
              </label>
              <div className="pub-comment-nickname-input-row">
                <input
                  id={`pub-comment-nickname-${postId}`}
                  type="text"
                  value={nickname}
                  maxLength={30}
                  required
                  onChange={(event) => setNickname(event.target.value)}
                  disabled={submitting}
                />
                {formState.canPostAsAuthor && (
                  <label className="pub-comment-as-author">
                    <input
                      type="checkbox"
                      checked={asAuthor}
                      onChange={(event) => setAsAuthor(event.target.checked)}
                      disabled={submitting}
                    />
                    <span>{ui("as author")}</span>
                  </label>
                )}
              </div>
            </div>
          </div>

          <label className="pub-comment-body-field">
            <span>{ui("Comment")}</span>
            <textarea
              value={body}
              maxLength={1000}
              required
              rows={6}
              onChange={(event) => setBody(event.target.value)}
              disabled={submitting}
              
            />
          </label>

          {formState.captchaRequired && challenge && (
            <div className="pub-comment-captcha">
              <span className="pub-comment-captcha-image">
                <Image
                  src={challenge.image}
                  width={200}
                  height={48}
                  alt="Six digit CAPTCHA"
                  unoptimized
                />
              </span>
              <button
                type="button"
                className="rounded border border-gray-400 bg-gray-100 px-3 py-1 hover:bg-gray-200 disabled:opacity-50"
                onClick={() => void loadChallenge()}
                disabled={submitting}
                aria-label={ui("New image")}
                title={ui("New image")}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="1em"
                  height="1em"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 11a8 8 0 1 0-2.34 5.66" />
                  <path d="M20 4v7h-7" />
                </svg>
              </button>
              <label>
                <span>{ui("Enter the six digits")}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={captchaAnswer}
                  onChange={(event) =>
                    setCaptchaAnswer(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  disabled={submitting}
                />
              </label>
            </div>
          )}

          <div className="pub-comment-form-buttons">
            <button
              type="submit"
              className="rounded border border-gray-400 bg-gray-100 px-3 py-1.5 hover:bg-gray-200 disabled:opacity-50"
              disabled={
                submitting ||
                nickname.trim().length === 0 ||
                body.trim().length === 0 ||
                (formState.captchaRequired && captchaAnswer.length !== 6)
              }
            >
              {ui("Post comment")}
            </button>
            <button
              type="button"
              className="rounded border border-gray-400 bg-gray-100 px-3 py-1.5 hover:bg-gray-200 disabled:opacity-50"
              onClick={() => setFormOpen(false)}
              disabled={submitting}
            >
              {ui("Cancel")}
            </button>
          </div>
        </form>
      )}
      </div>
    </section>
  );
}
