"use client";

import React from "react";
import { useRouter } from "next/navigation";

type Props = React.HTMLAttributes<HTMLDivElement> & {
  href: string;
};

export default function LinkDiv({ href, className, children, ...rest }: Props) {
  const router = useRouter();
  const handleClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const root = e.currentTarget as HTMLElement;
      const el = e.target as HTMLElement;
      const interactive = el.closest("a, button, input, textarea, [role='button']");
      if (interactive && interactive !== root) return;
      router.push(href);
    },
    [href, router],
  );
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        router.push(href);
      }
    },
    [href, router],
  );
  return (
    <div
      role="link"
      tabIndex={0}
      className={className}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {children}
    </div>
  );
}
